const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register() {
    ipcMain.handle('reports:list', async () => {
        try {
            const reportsDir = path.join(process.cwd(), 'reports');
            if (!fs.existsSync(reportsDir)) {
                return { success: true, data: [] };
            }
            const files = fs.readdirSync(reportsDir)
                .filter(f => f.endsWith('.html'))
                .map(f => {
                    const fp = path.join(reportsDir, f);
                    const stat = fs.statSync(fp);
                    const match = f.match(/(?:report_session_|benchmark_report_|report_realtime_)(\d+)/);
                    return {
                        name: f,
                        path: fp,
                        sessionId: match ? match[1] : null,
                        createdAt: stat.birthtime.toISOString(),
                        size: stat.size
                    };
                })
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return { success: true, data: files };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('reports:open', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }
            const { shell } = require('electron');
            const result = await shell.openPath(filePath);
            if (result !== '') {
                return { success: false, error: result };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('reports:delete', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }
            fs.unlinkSync(filePath);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('reports:convertToPdf', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }
            const { chromium } = require('playwright');
            const browser = await chromium.launch();
            const page = await browser.newPage();
            await page.goto('file:///' + filePath.replace(/\\/g, '/'));
            const outputPath = filePath.replace('.html', '.pdf');
            await page.pdf({
                path: outputPath,
                format: 'A4',
                printBackground: true,
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
            });
            await browser.close();
            return { success: true, outputPath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('reports:convertToDocx', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }
            const htmlToDocx = require('html-to-docx');
            const htmlContent = fs.readFileSync(filePath, 'utf-8');
            const outputPath = filePath.replace('.html', '.docx');
            const buffer = await htmlToDocx(htmlContent);
            fs.writeFileSync(outputPath, buffer);
            return { success: true, outputPath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
