"use strict";

function CallStore() {
    this.byCallId = {};
    this.byRemoteCallId = {};
    this.byRoomId = {};
}

CallStore.prototype.set = function(call) {
    console.log(
        "Storing call id=%s in room=%s for user=%s",
        call.callId, call.roomId, call.bridgeMxId
    );

    this.byCallId[call.callId] = call;
    this.byRemoteCallId[call.rCallId] = call;
    this.byRoomId[call.roomId] = call;
};

CallStore.prototype.delete = function(call) {
    delete this.byCallId[call.callId];
    delete this.byRemoteCallId[call.rCallId];
    delete this.byRoomId[call.roomId];
};

CallStore.prototype.getByCallId = function(callId) {
    return this.byCallId[callId];
};

CallStore.prototype.getByRemoteCallId = function(callId) {
    return this.byRemoteCallId[callId];
};

CallStore.prototype.getByRoomId = function(roomId) {
    return this.byRoomId[roomId];
};

module.exports = CallStore;
