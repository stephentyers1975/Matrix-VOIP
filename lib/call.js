"use strict";

function Call(callId, rCallId, roomId, bridgeMxId, bridgeNumber) {
    this.callId = callId;
    this.rCallId = rCallId;
    this.roomId = roomId;
    this.bridgeMxId = bridgeMxId;
    this.bridgeNumber = bridgeNumber;
}

module.exports = Call;
