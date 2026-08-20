const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

// innerHTML로 렌더링되는 문자열에 보간하기 전 사용자 입력값을 이스케이프한다.
export const escapeHtml = (str: string): string => {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
};
