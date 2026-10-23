const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function alertText(reason) {
    if (reason === 'APP_TERMINATION_SIGNAL') {
        return 'L!nc แจ้งเตือน: ระบบไม่ได้รับสัญญาณจากแอปตามปกติ กรุณาติดต่อผู้ใช้ด้วยความเข้าใจและความห่วงใย';
    }
    if (reason === 'SYSTEM_DISCONNECTED_ALERT') {
        return 'L!nc แจ้งเตือน: ระบบไม่ได้รับการติดต่อจากแอปมาระยะหนึ่ง อาจเกิดจากอินเทอร์เน็ตหรือสัญญาณขัดข้อง กรุณาตรวจสอบอย่างใจเย็นและติดต่อผู้ใช้ด้วยความห่วงใย';
    }
    return 'L!nc แจ้งเตือน: มีเหตุการณ์ที่ต้องตรวจสอบ กรุณาติดต่อผู้ใช้ด้วยความห่วงใย';
}

async function sendGuardianAlert(alertPayload) {
    // Sending is deliberately opt-in until guardian linking is verified end-to-end.
    if (process.env.LINE_ALERTS_ENABLED !== 'true') {
        return { sent: false, reason: 'disabled' };
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
        console.error('[LINE_ALERT] delivery unavailable: token_not_configured');
        return { sent: false, reason: 'not_configured' };
    }
    if (!alertPayload || typeof alertPayload.guardianLineId !== 'string' || !alertPayload.guardianLineId.trim()) {
        return { sent: false, reason: 'guardian_not_linked' };
    }

    let response;
    try {
        response = await fetch(LINE_PUSH_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: alertPayload.guardianLineId,
                messages: [{ type: 'text', text: alertText(alertPayload.reason) }]
            })
        });
    } catch (_) {
        // Network errors may contain request details; return a safe reason without logging them.
        console.error('[LINE_ALERT] delivery failed: network_error');
        return { sent: false, reason: 'provider_error' };
    }

    if (!response.ok) {
        // Do not log tokens, guardian IDs, or response bodies which may contain identifiers.
        console.error('[LINE_ALERT] delivery failed', response.status);
        return { sent: false, reason: 'provider_error' };
    }

    console.info('[LINE_ALERT] delivery accepted', alertPayload.reason || 'UNKNOWN_REASON');
    return { sent: true };
}

module.exports = { sendGuardianAlert, alertText };
