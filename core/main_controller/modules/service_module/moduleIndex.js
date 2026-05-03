const MainController = require('./controller/main');
const Command = require('./command/command');

class serviceModule {
    constructor(config, logger) {
        this.mainController = new MainController(config, logger);
        this.command = new Command(this.mainController);
    }

    // 为了防止获取命令前执行时后续的异步方法导致传出promise，强制将获取命令的方法改为异步，使得前方不得不await
    async getCommand() {
        return this.command;
    }
}

module.exports = serviceModule;
