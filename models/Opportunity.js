const mongoose = require('mongoose');

const OpportunitySchema = new mongoose.Schema({
    company: { type: String, required: true },
    role: { type: String, required: true },
    eligibility: { type: String, required: true },
    required_skills: { type: [String], default: [] },
    deadline: { type: Date, required: true },
    deadline_mentioned: { type: Boolean, default: false },
    application_link: { type: String, required: true },
    raw_message: { type: String, required: true },
    authenticity_score: { type: Number, default: 0 },
    authenticity_reason: { type: String, default: 'Not analyzed' },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Opportunity', OpportunitySchema);
