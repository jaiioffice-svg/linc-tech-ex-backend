function notFoundHandler(req, res) {
    return res.status(404).json({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested route was not found'
    });
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (error && error.type === 'entity.parse.failed') {
        status = 400;
        code = 'INVALID_JSON';
        message = 'Malformed JSON request body';
    } else if (error && error.type === 'entity.too.large') {
        status = 413;
        code = 'REQUEST_TOO_LARGE';
        message = 'Request body exceeds the allowed limit';
    }

    const internalCodeCandidates = [
        error && error.type,
        error && error.code
    ];

    const internalCode = internalCodeCandidates.find(value =>
        typeof value === 'string' &&
        /^[A-Z0-9_.-]{1,48}$/i.test(value)
    ) || 'UNEXPECTED_ERROR';

    console.error('[HTTP_ERROR]', JSON.stringify({
        method: req.method,
        status,
        code,
        internalCode
    }));

    return res.status(status).json({
        success: false,
        code,
        message
    });
}

module.exports = {
    notFoundHandler,
    errorHandler
};
