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
}
