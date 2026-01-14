const fs = require('fs');
const path = require('path');
const GameRoom = require('./GameRoom');

class RoomManager {
    constructor(io, dataDir) {
        this.io = io;
        this.dataDir = dataDir;
        this.rooms = new Map();
    }

    sanitizeRoomId(roomId) {
        if (typeof roomId !== 'string') return 'lobby';
        const cleaned = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleaned) return 'lobby';
        return cleaned.slice(0, 32);
    }

    getRoom(roomId) {
        const safeId = this.sanitizeRoomId(roomId);
        let room = this.rooms.get(safeId);
        if (!room) {
            room = new GameRoom(this.io, safeId, this.dataDir);
            this.rooms.set(safeId, room);
        }
        return room;
    }

    restartRoom(roomId) {
        const safeId = this.sanitizeRoomId(roomId);
        const fileBase = `room-${safeId}`;
        const stateFile = path.join(this.dataDir, `${fileBase}.json`);
        const tmpFile = path.join(this.dataDir, `${fileBase}.json.tmp`);

        this.rooms.delete(safeId);

        try { fs.unlinkSync(stateFile); } catch (err) {
            if (err.code !== 'ENOENT') console.error(err);
        }
        try { fs.unlinkSync(tmpFile); } catch (err) {
            if (err.code !== 'ENOENT') console.error(err);
        }
    }
}

module.exports = RoomManager;
