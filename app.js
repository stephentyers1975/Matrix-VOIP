var Promise = require("bluebird");
var uuid = require("uuid");

var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var Cli = require("matrix-appservice-bridge").Cli;
var Bridge = require("matrix-appservice-bridge").Bridge;
var MatrixUser = require("matrix-appservice-bridge").MatrixUser;
var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;

var VertoEndpoint = require("./lib/endpoint");
var CallStore = require("./lib/call-store");
var Call = require("./lib/call");

var REGISTRATION_FILE = "config/verto-single-registration.yaml";
var CONFIG_SCHEMA_FILE = "config/verto-single-config-schema.yaml";
var ROOM_STORE_FILE = "config/room-store.db";
var USER_STORE_FILE = "config/user-store.db";
var USER_PREFIX = "voip_";

var calls = new CallStore();

var prematureCandidatesForCall = {};
var verto, bridgeInst;

function getTargetNumber(localpart) {
    return localpart.replace(USER_PREFIX, "");
}

function generatePin() {
    return Math.floor(Math.random() * 10000); // random 4-digits
}

function handleEvent(request, context) {
    var event = request.getData();
    var number, call, promise;
    
    if (event.type === "m.room.member") {
        // we only care about bridge users
        if (context.targets.matrix.localpart.indexOf(USER_PREFIX) === 0) {
            console.log(
                "Member update: room=%s member=%s -> %s",
                event.room_id, event.state_key, event.content.membership
            );
            if (event.content.membership === "invite") {
                var intent = bridgeInst.getIntent(context.targets.matrix.getId());
                return intent.join(event.room_id).then(function() {
                    var room = new MatrixRoom(event.room_id);
                    room.set("bridge_user", context.targets.matrix.localpart);
                    bridgeInst.getRoomStore().setMatrixRoom(room);
                });
            }
            else if (event.content.membership === "leave" ||
                    event.content.membership === "ban") {
                console.log("fetching call, if any");
                let call = calls.getByRoomId(event.room_id);
                if (call) {
                    console.log("found call, handling");
                    calls.delete(call);
                    verto.sendBye(call);
                    return Promise.resolve("Done deleting call");
                } else {
                    console.log("no call to handle");
                }
            }
        } else {
            console.log("Ignoring event %s", JSON.stringify(event.content));
        }
    }
    else if (event.type === "m.call.invite") {
        console.log(
            "Call invite: room=%s number=%s member=%s content=%s",
            event.room_id, number, event.user_id, JSON.stringify(event.content)
        );

        return bridgeInst.getRoomStore().getMatrixRoom(event.room_id).then(function(room) {
            if (!room) {
                console.error("Got call in unknown room %s", event.room_id);
                throw new Error("unknown room");
            }

            console.log("Bridge user: %s", JSON.stringify(room.get("bridge_user")));
            number = getTargetNumber(room.get("bridge_user"));
            console.log("Initiating call on our end to %s", number);

            var candidateEvents = prematureCandidatesForCall[event.content.call_id] || [];
            var candidates = [];
            candidateEvents.forEach(function(candidateEvent) {
                candidateEvent.content.candidates.forEach(function(cand) {
                    candidates.push(cand);
                });
            });
            delete prematureCandidatesForCall[event.content.call_id];

            let rCallId = uuid.v4();
            call = new Call(event.content.call_id, rCallId, event.room_id, room.get("bridge_user"), number);
            call.data = {
                roomId: event.room_id,
                mxUserId: event.user_id,
                mxCallId: event.content.call_id,
                vertoCallId: rCallId,
                offer: event.content.offer.sdp,
                candidates: candidates,
                pin: generatePin(),
                timer: null,
                sentInvite: false
            };

            calls.set(call);
            return verto.attemptInvite(call, false);
        });
    }
    else if (event.type === "m.call.candidates") {
        console.log(
            "Call candidates: room=%s member=%s content=%s",
            event.room_id, event.user_id, JSON.stringify(event.content)
        );
        call = calls.getByCallId(event.content.call_id);
        if (!call) {
            console.error("Got candidate for unknown call id=%s", event.content.call_id);
        } else {
            event.content.candidates.forEach(function(cand) {
                call.data.candidates.push(cand);
            });
            return verto.attemptInvite(call, false);
        }
    }
    else if (event.type === "m.call.hangup") {
        console.log(
            "Call hangup: room=%s member=%s content=%s",
            event.room_id, event.user_id, JSON.stringify(event.content)
        );
        call = calls.getByCallId(event.content.call_id);
        if (!call) {
            console.error("Ignoring unknown call id=%s", event.content.call_id);
        } else {
            return verto.sendBye(call).then(function() {
                calls.delete(call);
            }).done(function() {
                console.log("Handled hangup of call id=%s", event.content.call_id);
            });
        }
    }
}


function runBridge(port, config) {
    // Create a verto instance and login, then listen on the bridge.
    verto = new VertoEndpoint(config.verto.url, config["verto-dialog-params"],
    function(msg) { // handle the incoming verto request
        if (!msg.params || msg.params.callID === undefined) {
            console.error("Missing CallID, unable to handle call event");
            return;
        }

        var call = calls.getByRemoteCallId(msg.params.callID);
        if (!call) {
            console.error("No call with ID '%s' exists.", msg.params.callID);
            return;
        }
                
        switch (msg.method) {
            case "verto.media":
                console.log("Trying to handle verto.media: %s", JSON.stringify(msg));
                if (msg.params.sdp === undefined) {
                    console.error("Unable to handle media, SDP data missing");
                    return vert.sendBye(call);
                }

                call.rData = msg.params.sdp;
                break;
            case "verto.answer":
                console.log("Trying to handle verto.answer: " + JSON.stringify(msg));

                // find out which user should be sending the answer
                bridgeInst.getRoomStore().getMatrixRoom(call.roomId).then(
                function(room) {
                    if (!room) {
                        throw new Error("Unknown room ID: " + call.roomId);
                    }
                    var intent = bridgeInst.getIntent("@" + call.bridgeMxId + ":" + bridgeInst.opts.domain);
                    return intent.sendEvent(call.roomId, "m.call.answer", {
                        call_id: call.callId,
                        version: 0,
                        answer: {
                            sdp: call.rData,
                            type: "answer"
                        }
                    });
                }).then(function() {
                    return verto.sendResponse({
                        method: msg.method
                    }, msg.id);
                }).done(function() {
                    console.log("Forwarded answer.");
                }, function(err) {
                    console.error("Failed to send m.call.answer: %s", err);
                    console.log(err.stack);
                    // TODO send verto error response?
                });
                break;
            case "verto.bye":
                var intent = bridgeInst.getIntent("@" + call.bridgeMxId + ":" + bridgeInst.opts.domain);
                intent.sendEvent(call.roomId, "m.call.hangup", {
                    call_id: call.callId,
                    version: 0
                });
                calls.delete(call);
                break;
            default:
                if (msg.method === undefined) {
                    console.log("Unknown message type: %", msg);
                } else {
                    console.log("Unhandled method: %s", msg.method);
                }
                break;
        }
    });

    bridgeInst = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.domain,
        registration: REGISTRATION_FILE,
        roomStore: ROOM_STORE_FILE,
        userStore: USER_STORE_FILE,
        queue: {
            type: "per_room",
            perRequest: true
        },

        controller: {
            onUserQuery: function(queriedUser) {
                var num = getTargetNumber(queriedUser.getId());
                return {
                    name: num + " (Bridge)"
                };
            },

            onEvent: function(request, context) {
                var promise = handleEvent(request, context);
                if (!promise) {
                    promise = Promise.resolve("unhandled event");
                }
                else {
                    console.log("[%s] Handling request", request.getId());
                }
                request.outcomeFrom(promise);
            }
        }
    });

    verto.login(
        config["verto-dialog-params"].login,
        config.verto.passwd
    ).done(function() {
        bridgeInst.run(port, config);
        console.log("Running bridge on port %s", port);
        bridgeInst.getRequestFactory().addDefaultTimeoutCallback(function(req) {
            console.error("DELAYED: %s", req.getId());
        }, 5000);
    }, function(err) {
        console.error("Failed to login to verto: %s", JSON.stringify(err));
        process.exit(1);
    });
}

var c = new Cli({
    port: 8191,
    registrationPath: REGISTRATION_FILE,
    bridgeConfig: {
        schema: CONFIG_SCHEMA_FILE
    },
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("vertobotsingle");
        reg.addRegexPattern("users", "@" + USER_PREFIX + ".*", true);
        console.log(
            "Generating registration to '%s' for the AS accessible from: %s",
            REGISTRATION_FILE, reg.url
        );
        callback(reg);
    },
    run: runBridge
});

c.run(); // check system args
