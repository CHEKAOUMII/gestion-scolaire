// Stub for future email channel (nodemailer integration)
module.exports = {
    name: 'email',
    send(rendered, event) {
        console.log('[notification:email] stub — not implemented', event.type);
        return { success: false, error: 'email channel not implemented' };
    },
};
