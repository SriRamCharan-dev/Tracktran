const mongoose = require('mongoose');

const ResumeImprovementSchema = new mongoose.Schema(
    {
        original: { type: String, default: '', trim: true, maxlength: 400 },
        improved: { type: String, default: '', trim: true, maxlength: 400 }
    },
    { _id: false }
);

const ResumeAnalysisSchema = new mongoose.Schema(
    {
        score: { type: Number, default: 0, min: 0, max: 100 },
        strengths: { type: [String], default: [] },
        weaknesses: { type: [String], default: [] },
        suggestions: { type: [String], default: [] },
        detectedSkills: { type: [String], default: [] },
        missingSkills: { type: [String], default: [] },
        improvedBullets: { type: [ResumeImprovementSchema], default: [] },
        analyzedAt: { type: Date, default: null },
        cleanTextSample: { type: String, default: '', maxlength: 12000 }
    },
    { _id: false }
);

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    password: { type: String, required: true },
    skills: { type: [String], default: [] },
    branch: { type: String, default: '', trim: true, maxlength: 120 },
    year: { type: String, default: '', trim: true, maxlength: 40 },
    resumeText: { type: String, default: '', select: false, maxlength: 20000 },
    resumeAnalysis: { type: ResumeAnalysisSchema, default: () => ({}) }
});

// Unique index for email is handled by the field definition above

module.exports = mongoose.model('User', UserSchema);
