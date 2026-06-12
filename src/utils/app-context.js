/**
 * Shared application context for route modules.
 * Initialized once at startup via initAppContext().
 */
let _ctx = null;

function initAppContext(ctx) {
    _ctx = Object.freeze({ ...ctx });
}

function getAppContext() {
    if (!_ctx) {
        throw new Error('App context not initialized — call initAppContext() before loading routes');
    }
    return _ctx;
}

const handler = {
    get(_target, prop) {
        if (prop === 'initAppContext') return initAppContext;
        if (prop === 'getAppContext') return getAppContext;
        return getAppContext()[prop];
    }
};

module.exports = new Proxy({}, handler);
