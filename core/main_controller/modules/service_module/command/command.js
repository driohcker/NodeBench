const commandDef = require('./command_def');

class Command {
    constructor(controller) {
        this.controller = controller;
    }

    async executeCommand(command) {
        if (!command) return;
        
        const cmdParts = command.split(' ');
        const cmdName = cmdParts[0].toLowerCase();
        const args = cmdParts.slice(1);
        
        const cmd = commandDef.commands.find(c => c.name === cmdName);
        
        if (cmd) {
            const method = cmd.method;
            
            if (method === 'help') {
                this.showHelp();
            } else if (this.controller[method]) {
                return await this.controller[method](...args);
            } else {
                console.log(`控制器中不存在方法: ${method}`);
            }
        } else {
            console.log('未知命令，请输入 help 查看可用命令');
        }
    }

    showHelp() {
        console.log('============================================');
        console.log('            被测服务控制命令');
        console.log('============================================');
        commandDef.commands.forEach(cmd => {
            console.log(`${cmd.name.padEnd(10)} - ${cmd.description}`);
        });
        console.log('============================================');
    }
}

module.exports = Command;