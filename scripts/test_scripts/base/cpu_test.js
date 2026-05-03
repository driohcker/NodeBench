import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = 'http://localhost:10000';

export default function () {
    // 测试CPU接口
    const cpuRes = http.get(`${BASE_URL}/cpu`);
    check(cpuRes, {
        'CPU test status is 200': (r) => r.status === 200,
    });
    //sleep(1);
}