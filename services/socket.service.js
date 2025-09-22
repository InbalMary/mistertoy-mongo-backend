import { logger } from './logger.service.js'
import { Server } from 'socket.io'
import { toyService } from '../api/toy/toy.service.js'

var gIo = null

export function setupSocketAPI(http) {
    gIo = new Server(http, {
        cors: {
            origin: '*',
        }
    })
    gIo.on('connection', socket => {
        logger.info(`New connected socket [id: ${socket.id}]`)

        socket.on('disconnect', socket => {
            logger.info(`Socket disconnected [id: ${socket.id}]`)
            if (socket.myTopic && socket.userName) {
                gIo.to(socket.myTopic).emit('chat-typing', {
                    userName: socket.userName,
                    isTyping: false
                })
            }
        })

        socket.on('chat-set-topic', async ({ topic, userName }) => {
            if (socket.myTopic && socket.myTopic !== topic) {
                socket.leave(socket.myTopic)
                logger.info(`Socket leaving topic ${socket.myTopic} [id: ${socket.id}]`)
            }
            socket.join(topic)
            socket.myTopic = topic
            socket.userName = userName || `Guest-${socket.id}`
            logger.info(`Socket joined topic ${topic} as ${socket.userName} [id: ${socket.id}]`)

            const toy = await toyService.getById(topic)
            const history = toy?.chatHistory || []  
            socket.emit('chat-history', history)
        })
        socket.on('chat-send-msg', async (msg) => {
            logger.info(`New chat msg from socket [id: ${socket.id}], topic ${socket.myTopic}`)

            const topic = socket.myTopic
            if (!topic) return

            msg.timestamp = new Date().toISOString()

            await toyService.addChatMsg(topic, msg)

            gIo.to(topic).emit('chat-add-msg', msg)
        })
        socket.on('chat-typing', data => {
            logger.info(`Typing event from ${data.userName} [id: ${socket.id}], in topic ${socket.myTopic}`)
            socket.broadcast.to(socket.myTopic).emit('chat-typing-update', data)
        })
        socket.on('user-watch', userId => {
            logger.info(`user-watch from socket [id: ${socket.id}], on user ${userId}`)
            socket.join('watching:' + userId)
        })
        socket.on('set-user-socket', userId => {
            logger.info(`Setting socket.userId = ${userId} for socket [id: ${socket.id}]`)
            socket.userId = userId
        })
        socket.on('unset-user-socket', () => {
            logger.info(`Removing socket.userId for socket [id: ${socket.id}]`)
            delete socket.userId
        })

    })
}

// Emit to all sockets in label or to all sockets
function emitTo({ type, data, label }) {
    if (label) gIo.to('watching:' + label.toString()).emit(type, data)
    else gIo.emit(type, data)
}

// Emit to single user
async function emitToUser({ type, data, userId }) {
    userId = userId.toString()
    const socket = await _getUserSocket(userId)

    if (socket) {
        logger.info(`Emiting event: ${type} to user: ${userId} socket [id: ${socket.id}]`)
        socket.emit(type, data)
    } else {
        logger.info(`No active socket for user: ${userId}`)
        // _printSockets()
    }
}

// If possible, send to all sockets BUT not the current socket 
// Optionally, broadcast to a room / to all

// 4 options:
// 1. all sockets in topic except excluded socket
// 2. all sockets except excluded socket
// 3. all sockets in topic
// 4. all sockets 
async function broadcast({ type, data, room = null, userId }) {
    userId = userId.toString()

    logger.info(`Broadcasting event: ${type}`)
    const excludedSocket = await _getUserSocket(userId)
    if (room && excludedSocket) {
        logger.info(`Broadcast to room ${room} excluding user: ${userId}`)
        excludedSocket.broadcast.to(room).emit(type, data)
    } else if (excludedSocket) {
        logger.info(`Broadcast to all excluding user: ${userId}`)
        excludedSocket.broadcast.emit(type, data)
    } else if (room) {
        logger.info(`Emit to room: ${room}`)
        gIo.to(room).emit(type, data)
    } else {
        logger.info(`Emit to all`)
        gIo.emit(type, data)
    }
}

async function _getUserSocket(userId) {
    const sockets = await _getAllSockets()
    const socket = sockets.find(s => s.userId === userId)
    return socket
}
async function _getAllSockets() {
    // return all Socket instances
    const sockets = await gIo.fetchSockets()
    return sockets
}

async function _printSockets() {
    const sockets = await _getAllSockets()
    console.log(`Sockets: (count: ${sockets.length}):`)
    sockets.forEach(_printSocket)
}
function _printSocket(socket) {
    console.log(`Socket - socketId: ${socket.id} userId: ${socket.userId}`)
}

export const socketService = {
    // set up the sockets service and define the API
    setupSocketAPI,
    // emit to everyone / everyone in a specific room (label)
    emitTo,
    // emit to a specific user (if currently active in system)
    emitToUser,
    // Send to all sockets BUT not the current socket - if found
    // (otherwise broadcast to a room / to all)
    broadcast,
}
