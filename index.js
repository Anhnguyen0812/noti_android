const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

// Cấu hình CORS
app.use(cors());
app.use(express.json());

// Cấu hình Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Lưu trữ thông tin users đang online
const users = new Map();
const rooms = new Map();

// API endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'Server is running',
    message: 'Chat Backend Server for Android App',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/users/online', (req, res) => {
  const onlineUsers = Array.from(users.values()).map(user => ({
    userId: user.userId,
    username: user.username,
    socketId: user.socketId
  }));
  res.json({ users: onlineUsers, count: onlineUsers.length });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomId, roomData]) => ({
    roomId,
    users: roomData.users,
    createdAt: roomData.createdAt
  }));
  res.json({ rooms: roomList, count: roomList.length });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Đăng ký user
  socket.on('register', (data) => {
    const { userId, username } = data;
    users.set(socket.id, {
      socketId: socket.id,
      userId,
      username,
      connectedAt: new Date()
    });
    
    console.log(`User registered: ${username} (${userId})`);
    
    // Thông báo cho tất cả clients về user mới
    io.emit('user_online', {
      userId,
      username,
      timestamp: new Date().toISOString()
    });
    
    // Gửi danh sách users online cho user mới
    socket.emit('online_users', Array.from(users.values()));
  });

  // Gửi tin nhắn riêng tư (1-1)
  socket.on('private_message', (data) => {
    const { toUserId, message, fromUserId, fromUsername } = data;
    
    // Tìm socket của người nhận
    const recipientSocket = Array.from(users.entries())
      .find(([_, user]) => user.userId === toUserId);
    
    if (recipientSocket) {
      const [socketId] = recipientSocket;
      
      // Gửi tin nhắn đến người nhận
      io.to(socketId).emit('private_message', {
        fromUserId,
        fromUsername,
        message,
        timestamp: new Date().toISOString()
      });
      
      // Xác nhận đã gửi thành công
      socket.emit('message_sent', {
        toUserId,
        message,
        timestamp: new Date().toISOString(),
        status: 'delivered'
      });
      
      console.log(`Private message from ${fromUsername} to ${toUserId}`);
    } else {
      // User không online
      socket.emit('message_failed', {
        toUserId,
        reason: 'User is offline',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Tạo hoặc join room cho nhóm chat
  socket.on('join_room', (data) => {
    const { roomId, userId, username } = data;
    
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: [],
        createdAt: new Date()
      });
    }
    
    const room = rooms.get(roomId);
    if (!room.users.find(u => u.userId === userId)) {
      room.users.push({ userId, username, socketId: socket.id });
    }
    
    // Thông báo cho room
    socket.to(roomId).emit('user_joined_room', {
      roomId,
      userId,
      username,
      timestamp: new Date().toISOString()
    });
    
    console.log(`User ${username} joined room ${roomId}`);
  });

  // Rời khỏi room
  socket.on('leave_room', (data) => {
    const { roomId, userId, username } = data;
    
    socket.leave(roomId);
    
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.users = room.users.filter(u => u.userId !== userId);
      
      // Xóa room nếu không còn ai
      if (room.users.length === 0) {
        rooms.delete(roomId);
      }
    }
    
    // Thông báo cho room
    socket.to(roomId).emit('user_left_room', {
      roomId,
      userId,
      username,
      timestamp: new Date().toISOString()
    });
    
    console.log(`User ${username} left room ${roomId}`);
  });

  // Gửi tin nhắn trong room
  socket.on('room_message', (data) => {
    const { roomId, message, fromUserId, fromUsername } = data;
    
    // Gửi tin nhắn đến tất cả trong room (trừ người gửi)
    socket.to(roomId).emit('room_message', {
      roomId,
      fromUserId,
      fromUsername,
      message,
      timestamp: new Date().toISOString()
    });
    
    // Xác nhận đã gửi
    socket.emit('message_sent', {
      roomId,
      message,
      timestamp: new Date().toISOString(),
      status: 'delivered'
    });
    
    console.log(`Room message in ${roomId} from ${fromUsername}`);
  });

  // User typing indicator
  socket.on('typing', (data) => {
    const { toUserId, fromUserId, fromUsername, isTyping } = data;
    
    const recipientSocket = Array.from(users.entries())
      .find(([_, user]) => user.userId === toUserId);
    
    if (recipientSocket) {
      const [socketId] = recipientSocket;
      io.to(socketId).emit('typing', {
        fromUserId,
        fromUsername,
        isTyping
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`User disconnected: ${user.username}`);
      
      // Xóa user khỏi danh sách
      users.delete(socket.id);
      
      // Thông báo cho tất cả clients
      io.emit('user_offline', {
        userId: user.userId,
        username: user.username,
        timestamp: new Date().toISOString()
      });
      
      // Xóa user khỏi tất cả rooms
      rooms.forEach((room, roomId) => {
        room.users = room.users.filter(u => u.socketId !== socket.id);
        if (room.users.length === 0) {
          rooms.delete(roomId);
        }
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Server is running on port ${PORT}`);
  console.log(`📱 Ready to handle Android app messages`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
