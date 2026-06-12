function registerAllRoutes(app) {
    const { registerMediaRoutes } = require('./media');
    const { registerAiRoutes } = require('./ai');

    registerMediaRoutes(app);
    registerAiRoutes(app);

    app.use('/', require('./health'));
    app.use('/api/music', require('./music'));
    app.use('/api/card', require('./card'));
    app.use('/api/community', require('./community'));
    app.use('/api/feedback', require('./feedback'));
    app.use('/api/upload', require('./upload'));
    app.use('/api', require('./library'));
    app.use('/api/user', require('./user'));
    app.use('/api/shop', require('./shop'));
    app.use('/api', require('./branding'));
    app.use('/api/mall', require('./mall'));
    app.use('/api/detection', require('./detection'));
    app.use('/api/mianjia', require('./mianjia'));
    app.use('/api/tasks', require('./tasks'));
    app.use('/api/points', require('./points'));
    app.use('/api/wechat', require('./wechat'));
}

module.exports = { registerAllRoutes };
