const readline = require('readline');
const Command = require('./command');

class CommandConsole {
    constructor(controller) {
        this.controller = controller;
        this.command = new Command(controller);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'test> '
        });
    }

    start() {
        this.command.showHelp();
        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const command = line.trim();
            await this.handleCommand(command);
            this.rl.prompt();
        }).on('close', () => {
            console.log('再见！');
            process.exit(0);
        });
    }

    async handleCommand(command) {
        await this.command.executeCommand(command);
    }
}

module.exports = CommandConsole;