import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_SERVER_URL || 'http://localhost:10000';
const TARGET = __ENV.K6_TARGET || 'cpu';

// 根据测试目标选择对应的API路径
const TARGET_PATHS = {
    cpu: '/cpu',
    memory: '/memory',
    io: '/io',
    disk: '/disk'
};

const path = TARGET_PATHS[TARGET] || '/cpu';

// 从环境变量读取stages配置
const stagesRaw = __ENV.K6_TEST_STAGES || '[]';
let stages = [];
try {
    stages = JSON.parse(stagesRaw);
} catch (e) {
    console.error(`Failed to parse K6_TEST_STAGES: ${stagesRaw}, error: ${e.message}`);
}

export const options = {
    stages: stages,
};

export default function () {
    const res = http.get(`${BASE_URL}${path}`);
    check(res, {
        [`${TARGET} test status is 200`]: (r) => r.status === 200,
    });
    // 模拟真实用户的思考时间，避免VU在请求失败后立即无间隔重试
    // 这能确保RPS真实反映系统处理能力，而非客户端的发送速率
    const thinkTime = parseFloat(__ENV.K6_THINK_TIME || '0.1');
    if (thinkTime > 0) {
        sleep(thinkTime);
    }
}
