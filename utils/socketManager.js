// Socket.IO Manager untuk real-time updates
let io = null;

const setSocketIO = (socketIO) => {
  io = socketIO;
  console.log('✅ Socket.IO initialized');
};

const getSocketIO = () => {
  return io;
};

// Emit events to all connected clients
const emitToAll = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};

// Emit QR code update
const emitQRCode = (qr) => {
  emitToAll('qr_update', { qr, status: 'qr' });
};

// Emit connection status
const emitConnectionStatus = (status, info = {}) => {
  emitToAll('connection_status', { status, ...info });
};

// Emit message sent status
const emitMessageSent = (data) => {
  emitToAll('message_sent', data);
};

// Emit morning greeting status
const emitMorningGreetingStatus = (data) => {
  emitToAll('morning_greeting_status', data);
};

// Emit error
const emitError = (error) => {
  emitToAll('error', { message: error.message || error });
};

module.exports = {
  setSocketIO,
  getSocketIO,
  emitToAll,
  emitQRCode,
  emitConnectionStatus,
  emitMessageSent,
  emitMorningGreetingStatus,
  emitError
};
