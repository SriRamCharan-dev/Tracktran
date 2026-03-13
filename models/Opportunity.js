const mongoose = require('mongoose');

const STATUS_VALUES = ['Applied', 'Interview', 'Rejected', 'Offer'];

const StatusHistorySchema = new mongoose.Schema(
    {
        status: { type: String, enum: STATUS_VALUES, required: true },
        changedAt: { type: Date, default: Date.now },
        note: { type: String, default: '', trim: true, maxlength: 240 }
    },
    { _id: false }
);

const OpportunitySchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    company: { type: String, required: true, trim: true, maxlength: 180 },
    role: { type: String, required: true, trim: true, maxlength: 180 },
    eligibility: { type: String, required: true, trim: true, maxlength: 1200 },
    required_skills: { type: [String], default: [] },
    deadline: { type: Date, required: true },
    deadline_mentioned: { type: Boolean, default: false },
    application_link: { type: String, required: true, trim: true, maxlength: 600 },
    raw_message: { type: String, required: true, maxlength: 6000 },
    authenticity_score: { type: Number, default: 0 },
    authenticity_reason: { type: String, default: 'Not analyzed', maxlength: 900 },
    category: { type: String, default: 'General', trim: true, maxlength: 80, index: true },
    application_status: { type: String, enum: STATUS_VALUES, default: 'Applied', index: true },
    status_history: { type: [StatusHistorySchema], default: [] },
    createdAt: { type: Date, default: Date.now, index: true }
});

OpportunitySchema.index({ owner: 1, deadline: 1 });
OpportunitySchema.index({ owner: 1, application_status: 1, createdAt: -1 });
OpportunitySchema.index({ owner: 1, company: 1, role: 1, application_link: 1 });
OpportunitySchema.index({ required_skills: 1 });

module.exports = mongoose.model('Opportunity', OpportunitySchema);
