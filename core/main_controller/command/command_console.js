const readline = require('readline');
const Command = require('./command');

class CommandConsole {
    constructor(controller) {
        this.controller = controller;
        this.command = new Command(controller);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'main> '
        });
    }

    async start() {
        await this.showHelp();
        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const command = line.trim();
            await this.handleCommand(command);
            this.rl.prompt();
        }).on('close', () => {
            this.close();
        });
    }

    async close() {
        console.log('正在关闭命令控制台...');
        this.rl.close();
        this.controller = null;
        this.command = null;
        this.rl = null;
        console.log('命令控制台已关闭');
    }

    async handleCommand(command) {
        await this.command.executeCommand(command);
    }

    async showHelp() {
        console.log('============================================');
        console.log('            主控端控制命令');
        console.log('============================================');
        await this.command.showHelp();
        console.log('============================================');
    }
}

module.exports = CommandConsole;