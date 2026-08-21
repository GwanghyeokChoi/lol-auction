import { escapeHtml } from '../utils/sanitize';

/*
 * 로컬 전용 통계 대시보드 (stats.html) 로직.
 * Firebase 콘솔에서 내보낸 JSON 파일을 FileReader로 읽어 브라우저 메모리에서만 파싱한다.
 * 네트워크 요청(fetch/XHR/Firebase SDK 등)을 전혀 사용하지 않으며, 업로드된 데이터를
 * localStorage/IndexedDB 등에 저장하지도 않는다 — 탭을 닫으면 메모리에서 전부 사라진다.
 */

/*
 * 경매 "완전 종료" 판별용 마커.
 * auctionService.ts 의 nextPlayer() 에서, 모든 팀이 정원을 채운 시점에만 아래 로그가 기록된다:
 *   `🎉 <strong>모든 팀 구성이 완료되었습니다! 경매를 종료합니다.</strong>`
 * 이모지/태그 마크업이 바뀌어도 견디도록 핵심 문구만 부분 문자열로 검사한다.
 *
 * 이 로그는 "팀 정원이 다 찬 즉시" 기록되므로, 경매되지 않은 선수가 waiting 으로 남는
 * 조기 종료 케이스도 정확히 완료로 잡힌다. (players 전원 상태로 추론하던 이전 방식은
 * 바로 이 케이스를 미완료로 잘못 분류했다.)
 */
const AUCTION_COMPLETE_LOG_MARKER = '모든 팀 구성이 완료되었습니다';

// --- [타입] ---
// Firebase 데이터 내보내기는 구조가 항상 앱의 타입과 정확히 일치한다는 보장이 없으므로
// (누락 필드, 예상 밖 타입 등) 방어적으로 파싱한다.
interface AnalyzedLog {
    msg: string;
    timestamp: number;
}

interface AnalyzedTeamMember {
    nickname: string;
    currentTier: string;
    most: string[];
}

interface AnalyzedTeam {
    leaderName: string;
    members: AnalyzedTeamMember[];
}

interface AnalyzedPlayer {
    name: string;
    nickname: string;
    status: string;
}

interface AnalyzedRoom {
    id: string;
    createdAt: number;              // 방(링크) 생성 시각
    complete: boolean;
    completionTime: number | null;  // 완료 방의 종료 일시 (= 완료 로그 엔트리의 timestamp)
    firstLogTime: number | null;    // 첫 로그 시각 = 실질적인 경매 진행 시작 시점 (아래 주석 참고)
    auctionStarted: boolean;        // 방장이 '경매 시작'을 눌렀는지 여부
    leaderNames: string[];
    teams: AnalyzedTeam[];
    players: AnalyzedPlayer[];
    logs: AnalyzedLog[];
}

interface PeriodBucket {
    key: string;
    label: string;
    total: number;
    complete: number;
    incomplete: number;
}

interface Summary {
    total: number;
    completeCount: number;
    incompleteCount: number;
    completionRate: number;
    avgAuctionMs: number | null; // 실제 경매 진행 시간 (첫 로그 ~ 완료 로그)
    avgPrepMs: number | null;    // 준비 시간 (방 생성 ~ 첫 로그)
    avgMembersPerLeader: number | null;
}

// --- [방어적 파싱 헬퍼] ---
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// --- [내보내기 JSON 최상위 정규화] ---
// 내보낸 위치에 따라 최상위가 { rooms: {...} } 이거나, rooms 노드 자체를 내보내
// { $room_id: {...}, ... } 형태로 최상위가 바로 room 목록일 수 있다.
function extractRoomMap(parsed: unknown): Record<string, unknown> {
    if (!isPlainObject(parsed)) {
        throw new Error('JSON 최상위가 객체 형태가 아닙니다. Firebase 콘솔에서 내보낸 JSON 파일이 맞는지 확인해 주세요.');
    }
    if ('rooms' in parsed && isPlainObject(parsed.rooms)) {
        return parsed.rooms;
    }
    return parsed;
}

function analyzeRoom(id: string, raw: unknown): AnalyzedRoom | null {
    if (!isPlainObject(raw)) return null;

    const info = isPlainObject(raw.info) ? raw.info : {};
    const createdAt = asNumber(info.createdAt);
    if (createdAt === null) return null; // 생성 시각이 없으면 기간 판별이 불가능하므로 대상에서 제외

    const teamsRaw = isPlainObject(raw.teams) ? raw.teams : {};
    const playersRaw = isPlainObject(raw.players) ? raw.players : {};
    const logsRaw = isPlainObject(raw.logs) ? raw.logs : {};
    const liveRaw = isPlainObject(raw.live) ? raw.live : {};

    // [필터] 선수 명단이 아예 없는 방(팀장만 만들고 방치한 방)은 완료/미완료를 따지기 전에
    // 통계 대상에서 완전히 제외한다. 이후 모든 집계(전체 방 수/완료율/기간별/분포)에 반영된다.
    if (Object.keys(playersRaw).length === 0) return null;

    const players: AnalyzedPlayer[] = Object.values(playersRaw)
        .filter(isPlainObject)
        .map((p) => ({
            name: asString(p.name, '(이름 없음)'),
            nickname: asString(p.nickname, '-'),
            status: asString(p.status, 'waiting'),
        }));

    const logs: AnalyzedLog[] = Object.values(logsRaw)
        .filter(isPlainObject)
        .map((l) => ({ msg: asString(l.msg), timestamp: asNumber(l.timestamp) ?? 0 }))
        .filter((l) => l.msg.length > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

    // 완료 판별: 경매 완전 종료 시에만 남는 로그가 있는지로만 판단한다.
    // 종료 일시도 동일한 로그 엔트리의 timestamp를 그대로 사용한다(가장 정확한 종료 시점).
    const completionLog = logs.find((l) => l.msg.includes(AUCTION_COMPLETE_LOG_MARKER)) ?? null;
    const complete = completionLog !== null;
    const completionTime = completionLog !== null ? completionLog.timestamp : null;

    /*
     * [경매 진행 시작 시점]
     * 앱에는 "경매 시작" 시점에 남는 로그가 없다(roomService.startAuctionProcess / triggerNextAuction
     * 모두 live 노드만 갱신하고 logs에는 쓰지 않는다). logs에 기록되는 이벤트는 입찰/낙찰/유찰/퍼즈뿐이다.
     * 따라서 실질적인 경매 진행 시작에 가장 가까운 관측값은 "첫 로그의 timestamp"다.
     */
    const firstLogTime = logs.length > 0 ? logs[0].timestamp : null;

    /*
     * [경매가 시작된 방인지]
     * live.playerOrder 는 createRoom/registerPlayers 에서 항상 []로 초기화되고,
     * 방장이 '경매 시작'을 눌렀을 때(startAuctionProcess)에만 셔플된 선수 목록으로 채워진다.
     * 즉 playerOrder 가 비어있지 않다는 것은 경매가 실제로 시작됐다는 뜻이다.
     * (로그가 남았다면 그 자체로도 경매가 진행된 증거이므로 OR 로 함께 본다)
     */
    const auctionStarted = asStringArray(liveRaw.playerOrder).length > 0 || logs.length > 0;

    const teamEntries = Object.values(teamsRaw).filter(isPlainObject);
    const leaderNames = teamEntries.map((t) => asString(t.leaderName, '(이름 없음)'));

    const teams: AnalyzedTeam[] = teamEntries.map((t) => {
        const memberIds = asStringArray(t.members);
        const members: AnalyzedTeamMember[] = memberIds.map((pid) => {
            const p = playersRaw[pid];
            if (!isPlainObject(p)) {
                return { nickname: '(알 수 없음)', currentTier: '-', most: [] };
            }
            return {
                nickname: asString(p.nickname, '-'),
                currentTier: asString(p.currentTier, '-'),
                most: asStringArray(p.most),
            };
        });
        return { leaderName: asString(t.leaderName, '(이름 없음)'), members };
    });

    return { id, createdAt, complete, completionTime, firstLogTime, auctionStarted, leaderNames, teams, players, logs };
}

// 업로드된 스냅샷에 들어있는 방은 생성 시점과 무관하게 모두 통계에 포함한다.
// (24시간 경과 필터는 실시간 Firebase 접근을 전제로 한 조건이라 스냅샷 분석에는 의미가 없어 제거)
function analyzeAll(parsed: unknown): AnalyzedRoom[] {
    const roomMap = extractRoomMap(parsed);
    const rooms: AnalyzedRoom[] = [];
    for (const [id, raw] of Object.entries(roomMap)) {
        const analyzed = analyzeRoom(id, raw);
        if (!analyzed) continue;
        rooms.push(analyzed);
    }
    return rooms;
}

// --- [집계] ---
const pad2 = (n: number): string => String(n).padStart(2, '0');
const dayKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const monthKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const yearKey = (ts: number): string => String(new Date(ts).getFullYear());

function countByKey(rooms: AnalyzedRoom[], keyFn: (ts: number) => string): Map<string, { complete: number; incomplete: number }> {
    const map = new Map<string, { complete: number; incomplete: number }>();
    for (const r of rooms) {
        const key = keyFn(r.createdAt);
        const b = map.get(key) ?? { complete: 0, incomplete: 0 };
        if (r.complete) b.complete++; else b.incomplete++;
        map.set(key, b);
    }
    return map;
}

const toBucket = (
    key: string,
    label: string,
    counts: Map<string, { complete: number; incomplete: number }>,
): PeriodBucket => {
    const c = counts.get(key) ?? { complete: 0, incomplete: 0 };
    return { key, label, complete: c.complete, incomplete: c.incomplete, total: c.complete + c.incomplete };
};

// 기준 시각: 데이터에 존재하는 가장 최근 방 생성 시각.
// (업로드 시점이 아닌 데이터 기준이라, 오래된 스냅샷을 올려도 그래프가 비어 보이지 않는다)
function latestCreatedAt(rooms: AnalyzedRoom[]): number {
    return rooms.reduce((max, r) => Math.max(max, r.createdAt), 0) || Date.now();
}

// 일별: 최근 30일 (빈 날짜도 0으로 채워 시간축이 끊기지 않게 함)
function buildDayBuckets(rooms: AnalyzedRoom[]): PeriodBucket[] {
    const counts = countByKey(rooms, dayKey);
    const anchor = new Date(latestCreatedAt(rooms));
    anchor.setHours(0, 0, 0, 0);
    const out: PeriodBucket[] = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(anchor);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        out.push(toBucket(key, `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`, counts));
    }
    return out;
}

// 월별: 최근 12개월
function buildMonthBuckets(rooms: AnalyzedRoom[]): PeriodBucket[] {
    const counts = countByKey(rooms, monthKey);
    const anchor = new Date(latestCreatedAt(rooms));
    const out: PeriodBucket[] = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
        out.push(toBucket(key, `${String(d.getFullYear()).slice(2)}/${pad2(d.getMonth() + 1)}`, counts));
    }
    return out;
}

// 년도별: 데이터에 존재하는 모든 연도 (중간에 빈 연도가 있으면 0으로 채움)
function buildYearBuckets(rooms: AnalyzedRoom[]): PeriodBucket[] {
    const counts = countByKey(rooms, yearKey);
    if (rooms.length === 0) return [];
    const years = rooms.map((r) => new Date(r.createdAt).getFullYear());
    const min = Math.min(...years);
    const max = Math.max(...years);
    const out: PeriodBucket[] = [];
    for (let y = min; y <= max; y++) out.push(toBucket(String(y), String(y), counts));
    return out;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function weekdayDistribution(rooms: AnalyzedRoom[]): number[] {
    const counts = new Array(7).fill(0) as number[];
    rooms.forEach((r) => { counts[new Date(r.createdAt).getDay()]++; });
    return counts;
}

function hourDistribution(rooms: AnalyzedRoom[]): number[] {
    const counts = new Array(24).fill(0) as number[];
    rooms.forEach((r) => { counts[new Date(r.createdAt).getHours()]++; });
    return counts;
}

function computeSummary(rooms: AnalyzedRoom[]): Summary {
    const total = rooms.length;
    const completeRooms = rooms.filter((r) => r.complete);
    const completionRate = total > 0 ? (completeRooms.length / total) * 100 : 0;

    const mean = (xs: number[]): number | null =>
        xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    /*
     * [소요 시간 계산 - 수정됨]
     * 이전에는 info.createdAt(=링크 생성 시각) ~ 완료 로그를 "소요 시간"으로 썼는데,
     * 그 사이에는 링크 공유 → 전원 접속 대기 → CSV 명단 등록 → '경매 시작' 클릭까지의
     * 준비 시간이 통째로 포함되어 실제 경매 진행 시간보다 크게 부풀려진다.
     * 앱에 '경매 시작' 로그가 없으므로, 진행 시작에 가장 가까운 관측값인 첫 로그 시각을 기준으로 쓴다.
     */
    const avgAuctionMs = mean(
        completeRooms
            .map((r) => (r.completionTime !== null && r.firstLogTime !== null ? r.completionTime - r.firstLogTime : null))
            .filter((v): v is number => v !== null && v >= 0),
    );

    // 참고 지표: 방 생성 ~ 첫 로그 (준비 시간). 위 왜곡의 원인이 얼마나 컸는지 보여준다.
    const avgPrepMs = mean(
        completeRooms
            .map((r) => (r.firstLogTime !== null ? r.firstLogTime - r.createdAt : null))
            .filter((v): v is number => v !== null && v >= 0),
    );

    let totalMembers = 0;
    let totalLeaders = 0;
    completeRooms.forEach((r) => {
        totalLeaders += r.teams.length;
        totalMembers += r.teams.reduce((sum, t) => sum + t.members.length, 0);
    });
    const avgMembersPerLeader = totalLeaders > 0 ? totalMembers / totalLeaders : null;

    return {
        total,
        completeCount: completeRooms.length,
        incompleteCount: total - completeRooms.length,
        completionRate,
        avgAuctionMs,
        avgPrepMs,
        avgMembersPerLeader,
    };
}

// --- [포맷 헬퍼] ---
function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '알 수 없음';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}시간`);
    if (m > 0) parts.push(`${m}분`);
    if (h === 0) parts.push(`${s}초`);
    return parts.join(' ') || '0초';
}

function formatDateTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatLogTime(ts: number): string {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// --- [렌더링] ---
function renderSummary(summary: Summary): string {
    const auctionText = summary.avgAuctionMs !== null ? formatDuration(summary.avgAuctionMs) : '-';
    const prepText = summary.avgPrepMs !== null ? formatDuration(summary.avgPrepMs) : '-';
    const avgMembersText = summary.avgMembersPerLeader !== null ? summary.avgMembersPerLeader.toFixed(2) : '-';
    return `
        <div class="summary-grid">
            <div class="stat-card"><div class="label">전체 방 수</div><div class="value">${summary.total}</div></div>
            <div class="stat-card"><div class="label">완료된 방</div><div class="value green">${summary.completeCount}</div></div>
            <div class="stat-card"><div class="label">미완료 방</div><div class="value red">${summary.incompleteCount}</div></div>
            <div class="stat-card"><div class="label">완료율</div><div class="value gold">${summary.completionRate.toFixed(1)}%</div></div>
            <div class="stat-card"><div class="label">평균 경매 진행 시간 <span class="hint" title="첫 로그 ~ 완료 로그">?</span></div><div class="value">${auctionText}</div></div>
            <div class="stat-card"><div class="label">평균 준비 시간 <span class="hint" title="방 생성 ~ 첫 로그 (링크 공유·명단 등록 대기)">?</span></div><div class="value">${prepText}</div></div>
            <div class="stat-card"><div class="label">팀장당 평균 팀원 수 (완료 방)</div><div class="value">${avgMembersText}</div></div>
        </div>
    `;
}

// 게이지(채워진 미터) 형태의 분포 렌더링. 값이 0이어도 트랙은 보인다.
function renderGauges(counts: number[], labels: string[]): string {
    const max = Math.max(1, ...counts);
    return counts.map((c, i) => `
        <div class="gauge-row">
            <span class="gauge-label">${escapeHtml(labels[i])}</span>
            <span class="gauge-track">
                <span class="gauge-fill" style="width:${(c / max) * 100}%"></span>
                <span class="gauge-value">${c}</span>
            </span>
        </div>
    `).join('');
}

// 완료/미완료 누적(stacked) 막대 그래프. 막대 전체 높이 = 해당 기간 사용 횟수.
function renderChart(buckets: PeriodBucket[]): string {
    if (buckets.length === 0) return '<p class="empty-note">데이터 없음</p>';
    const max = Math.max(1, ...buckets.map((b) => b.total));
    const cols = buckets.map((b) => {
        const heightPct = (b.total / max) * 100;
        // 세그먼트 높이는 막대(=total) 내부 비율
        const completePct = b.total > 0 ? (b.complete / b.total) * 100 : 0;
        const incompletePct = b.total > 0 ? (b.incomplete / b.total) * 100 : 0;
        const tip = `${b.key} · 사용 ${b.total} (완료 ${b.complete} / 미완료 ${b.incomplete})`;
        return `
            <div class="chart-col" title="${escapeHtml(tip)}">
                <div class="chart-count">${b.total > 0 ? b.total : ''}</div>
                <div class="chart-bar-area">
                    <div class="chart-stack" style="height:${heightPct}%">
                        <div class="chart-seg complete" style="height:${completePct}%"></div>
                        <div class="chart-seg incomplete" style="height:${incompletePct}%"></div>
                    </div>
                </div>
                <div class="chart-label">${escapeHtml(b.label)}</div>
            </div>
        `;
    }).join('');
    const range = buckets.length > 1 ? `${buckets[0].key} ~ ${buckets[buckets.length - 1].key}` : buckets[0].key;
    return `
        <div class="chart-range">${escapeHtml(range)}</div>
        <div class="chart-bars">${cols}</div>
    `;
}

/*
 * 로그를 시간순 채팅 스타일로 렌더링한다 (logs는 analyzeRoom에서 이미 timestamp 오름차순 정렬됨).
 * l.msg 를 이스케이프하지 않고 그대로 넣는 이유: 로그 문자열은 앱이 만든 <strong>/<span> 마크업을
 * 포함하고, 그 안의 사용자 입력(팀장·선수 이름)은 auctionService에서 저장 전에 이미 escapeHtml 처리된다.
 */
function renderLogList(logs: AnalyzedLog[]): string {
    return logs
        .map((l) => `<div class="log-item"><span class="log-time">[${formatLogTime(l.timestamp)}]</span>${l.msg}</div>`)
        .join('');
}

function renderCompleteRoom(room: AnalyzedRoom): string {
    const teamsHtml = room.teams.map((t) => {
        const membersHtml = t.members.length > 0
            ? `<ul>${t.members.map((m) => `<li>${escapeHtml(m.nickname)} <span class="tier-tag">${escapeHtml(m.currentTier)}</span> — Most: ${m.most.length > 0 ? m.most.map(escapeHtml).join(', ') : '-'}</li>`).join('')}</ul>`
            : '<p class="empty-note">팀원 없음</p>';
        return `<div class="team-block"><div class="team-leader">${escapeHtml(t.leaderName)}</div>${membersHtml}</div>`;
    }).join('');

    const logsHtml = room.logs.length > 0
        ? renderLogList(room.logs)
        : '<p class="empty-note">로그 없음</p>';

    // 진행 시간 = 첫 로그 ~ 완료 로그 (방 생성 시각이 아님 — 준비 시간 제외)
    const durationText = room.completionTime !== null && room.firstLogTime !== null
        ? formatDuration(room.completionTime - room.firstLogTime)
        : '알 수 없음';
    const prepText = room.firstLogTime !== null
        ? formatDuration(room.firstLogTime - room.createdAt)
        : '알 수 없음';

    return `
        <details class="room-details">
            <summary>
                <span><span class="room-id">${escapeHtml(room.id)}</span></span>
                <span class="room-meta">${formatDateTime(room.createdAt)} 생성 · 진행 ${durationText}</span>
            </summary>
            <div class="room-body">
                <p class="room-info-line"><strong>방 생성:</strong> ${formatDateTime(room.createdAt)}</p>
                <p class="room-info-line"><strong>경매 진행 시작(첫 로그):</strong> ${room.firstLogTime !== null ? formatDateTime(room.firstLogTime) : '알 수 없음'} <span class="muted">(준비 ${prepText})</span></p>
                <p class="room-info-line"><strong>경매 종료:</strong> ${room.completionTime !== null ? formatDateTime(room.completionTime) : '알 수 없음'}</p>
                <p class="room-info-line"><strong>진행 시간:</strong> ${durationText}</p>
                <p class="room-info-line"><strong>팀장:</strong> ${room.leaderNames.length > 0 ? room.leaderNames.map(escapeHtml).join(', ') : '없음'}</p>
                <h3 style="margin-top:14px;">팀별 팀원</h3>
                ${teamsHtml || '<p class="empty-note">팀 없음</p>'}
                <h3 style="margin-top:14px;">로그</h3>
                <div class="log-list">${logsHtml}</div>
            </div>
        </details>
    `;
}

function renderIncompleteRoom(room: AnalyzedRoom): string {
    const playersHtml = room.players.length > 0
        ? `<ul class="player-flat-list">${room.players.map((p) => `<li>${escapeHtml(p.name)} (${escapeHtml(p.nickname)}) <span class="status-tag ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span></li>`).join('')}</ul>`
        : '<p class="empty-note">없음</p>';

    return `
        <details class="room-details">
            <summary>
                <span><span class="room-id">${escapeHtml(room.id)}</span></span>
                <span class="room-meta">${formatDateTime(room.createdAt)} 생성</span>
            </summary>
            <div class="room-body">
                <p class="room-info-line"><strong>방 생성:</strong> ${formatDateTime(room.createdAt)}</p>
                <p class="room-info-line"><strong>팀장:</strong> ${room.leaderNames.length > 0 ? room.leaderNames.map(escapeHtml).join(', ') : '없음'}</p>
                <h3 style="margin-top:14px;">등록된 참가자</h3>
                ${playersHtml}
                ${room.logs.length > 0
                    ? `<h3 style="margin-top:14px;">로그</h3><div class="log-list">${renderLogList(room.logs)}</div>`
                    : ''}
            </div>
        </details>
    `;
}

function render(rooms: AnalyzedRoom[]): void {
    const resultSection = document.getElementById('result-section');
    if (!resultSection) return;

    const summary = computeSummary(rooms);

    const completeRooms = rooms.filter((r) => r.complete).sort((a, b) => b.createdAt - a.createdAt);
    const incompleteRooms = rooms.filter((r) => !r.complete).sort((a, b) => b.createdAt - a.createdAt);

    // [리스트 필터] 미완료 방 중 '경매가 실제로 시작된' 방만 목록에 표시한다.
    // 집계(요약 카드/기간별 그래프/분포)는 위의 incompleteRooms 전체를 그대로 쓰므로 영향받지 않는다.
    const listedIncomplete = incompleteRooms.filter((r) => r.auctionStarted);
    const hiddenIncomplete = incompleteRooms.length - listedIncomplete.length;

    resultSection.innerHTML = `
        <h2>요약</h2>
        ${renderSummary(summary)}

        <h2>기간별 사용 추이</h2>
        <div class="agg-tabs">
            <button type="button" class="agg-tab-btn active" data-period="day">일별</button>
            <button type="button" class="agg-tab-btn" data-period="month">월별</button>
            <button type="button" class="agg-tab-btn" data-period="year">년도별</button>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-swatch complete"></span>완료</span>
            <span class="legend-item"><span class="legend-swatch incomplete"></span>미완료</span>
            <span class="legend-note">막대 전체 높이 = 해당 기간 사용 횟수</span>
        </div>
        <div class="chart-box">
            <div id="chart-day">${renderChart(buildDayBuckets(rooms))}</div>
            <div id="chart-month" class="hidden">${renderChart(buildMonthBuckets(rooms))}</div>
            <div id="chart-year" class="hidden">${renderChart(buildYearBuckets(rooms))}</div>
        </div>

        <h2>생성 분포</h2>
        <div class="dist-grid">
            <div>
                <h3>요일별</h3>
                ${renderGauges(weekdayDistribution(rooms), WEEKDAY_LABELS)}
            </div>
            <div>
                <h3>시간대별</h3>
                ${renderGauges(hourDistribution(rooms), Array.from({ length: 24 }, (_, i) => `${i}시`))}
            </div>
        </div>

        <h2>완료된 방 (${completeRooms.length}건)</h2>
        ${completeRooms.length > 0 ? completeRooms.map(renderCompleteRoom).join('') : '<p class="empty-note">해당 없음</p>'}

        <h2>미완료 방 (${listedIncomplete.length}건)</h2>
        ${hiddenIncomplete > 0
            ? `<p class="list-note">경매가 시작되지 않은 방 ${hiddenIncomplete}건은 목록에서 생략했습니다. (집계에는 포함)</p>`
            : ''}
        ${listedIncomplete.length > 0 ? listedIncomplete.map(renderIncompleteRoom).join('') : '<p class="empty-note">해당 없음</p>'}
    `;

    // 기간별 그래프 탭 전환 (애니메이션 없이 즉시 교체)
    const tabButtons = resultSection.querySelectorAll<HTMLButtonElement>('.agg-tab-btn');
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            tabButtons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            (['day', 'month', 'year'] as const).forEach((p) => {
                const el = document.getElementById(`chart-${p}`);
                if (el) el.classList.toggle('hidden', p !== period);
            });
        });
    });

    resultSection.classList.remove('hidden');
}

function showError(message: string): void {
    const errorBox = document.getElementById('error-box');
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('visible');
}

function clearError(): void {
    const errorBox = document.getElementById('error-box');
    if (!errorBox) return;
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
}

function setLoading(on: boolean): void {
    document.getElementById('loading-box')?.classList.toggle('hidden', !on);
    const btn = document.getElementById('btn-render-text') as HTMLButtonElement | null;
    if (btn) btn.disabled = on;
}

// 새 입력을 처리하기 직전 상태 초기화: 이전 에러/결과를 지우고 로딩 표시를 켠다.
function beginLoading(): void {
    clearError();
    document.getElementById('result-section')?.classList.add('hidden');
    setLoading(true);
}

/*
 * 로딩 UI가 "실제로 화면에 그려진 뒤" 무거운 동기 작업(JSON.parse + 집계 + innerHTML 렌더)을 시작한다.
 * requestAnimationFrame 콜백은 해당 프레임의 paint '직전'에 실행되므로, 한 번만 쓰면
 * 로딩 인디케이터가 그려지기 전에 작업이 시작되어 UI가 멈춘 채로 남는다.
 * rAF를 두 번 겹치면 두 번째 콜백은 첫 프레임의 paint가 끝난 뒤에 실행되므로 로딩이 확실히 보인다.
 */
function afterPaint(fn: () => void): void {
    requestAnimationFrame(() => requestAnimationFrame(fn));
}

/*
 * 파싱 → 집계 → 렌더.
 *
 * [메모리 정리 방침]
 * 입력 원문(수 MB짜리 문자열)과 JSON.parse 결과(수백~수천 개 방의 원본 객체)는
 * 집계에 필요한 값을 모두 추출한 직후 참조를 끊는다. 렌더링에는 가공된 AnalyzedRoom[]만 쓰인다.
 * - 원문은 호출자가 넘긴 box의 value를 비워서 해제한다(호출자 클로저가 문자열을 붙들지 않도록).
 * - 원본 객체는 render() 호출 '전에' null을 넣어, 무거운 DOM 렌더 중에는 이미 GC 대상이 되게 한다.
 * AnalyzedRoom은 원본에서 map/filter로 새로 만든 객체·배열만 담으므로 원본을 참조하지 않는다.
 *
 * 성공/실패와 무관하게 로딩 해제와 입력 정리(cleanupInput)는 반드시 수행한다.
 */
function analyzeAndRender(box: { value: string }, cleanupInput: () => void): void {
    try {
        let raw: unknown = JSON.parse(box.value);
        box.value = '';               // 입력 원문 문자열 참조 해제
        const rooms = analyzeAll(raw);
        raw = null;                   // 원본 JSON 객체 전체 참조 해제 (GC 대상)
        render(rooms);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        showError(`데이터를 처리하지 못했습니다. Firebase 콘솔에서 내보낸 JSON이 맞는지 확인해 주세요.\n(${detail})`);
    } finally {
        box.value = '';               // 파싱 실패 시에도 원문을 남기지 않는다
        cleanupInput();
        setLoading(false);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
    const textarea = document.getElementById('json-textarea') as HTMLTextAreaElement | null;
    const btnRenderText = document.getElementById('btn-render-text') as HTMLButtonElement | null;

    // [입력 1] 파일 업로드: 파일을 고르면 확인 절차 없이 즉시 파싱·렌더링 (기존 동작 유지)
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        beginLoading();

        // FileReader로 로컬에서만 읽는다 (서버 전송 없음).
        let reader: FileReader | null = new FileReader();
        reader.onload = () => {
            // reader.result 가 원본 텍스트를 그대로 붙들고 있으므로 box로 옮긴 뒤 reader를 해제한다.
            const box = { value: typeof reader?.result === 'string' ? reader.result : '' };
            if (reader) { reader.onload = null; reader.onerror = null; }
            reader = null; // FileReader / File 참조 해제

            afterPaint(() => analyzeAndRender(box, () => {
                // 같은 파일을 다시 골라도 change가 발생하도록 값을 비운다 (File 참조도 함께 해제됨)
                fileInput.value = '';
            }));
        };
        reader.onerror = () => {
            if (reader) { reader.onload = null; reader.onerror = null; }
            reader = null;
            fileInput.value = '';
            setLoading(false);
            showError('파일을 읽는 중 오류가 발생했습니다.');
        };
        reader.readAsText(file);
    });

    // [입력 2] 텍스트 붙여넣기: 입력 중에는 아무것도 하지 않고, 버튼을 눌렀을 때만 파싱한다.
    btnRenderText?.addEventListener('click', () => {
        const text = textarea?.value.trim() ?? '';
        if (text.length === 0) {
            clearError();
            document.getElementById('result-section')?.classList.add('hidden');
            showError('붙여넣은 JSON 텍스트가 없습니다. 텍스트를 입력한 뒤 다시 시도해 주세요.');
            return;
        }

        beginLoading();
        const box = { value: text };
        afterPaint(() => analyzeAndRender(box, () => {
            // 성공/실패 무관하게 textarea를 비운다
            if (textarea) textarea.value = '';
        }));
    });
});
