const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    skills: { type: [String], default: [] },
    branch: { type: String, default: '' },
    year: { type: String, default: '' },
});

module.exports = mongoose.model('User', UserSchema);
