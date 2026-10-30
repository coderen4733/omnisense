// 숫자를 두 자리 문자열로 맞추기 (예: 7 => "07")
const pad = (value: number) => String(value).padStart(2, '0')

//  * 날짜/시간 표시 형식 변환
//  - 백엔드는 UTC 시각을 ISO 형식 문자열로 보냄 (예: "2026-10-08T08:53:39.123456Z")
//  - new Date()로 바꾸면 브라우저의 현지 시각(한국: UTC+9)으로 자동 변환됨
//  - 결과 예) "2026.10.08. 17:53:39"
export function formatDateTime(value: string): string {
  const date = new Date(value)
  // 잘못된 날짜 문자열이면 "-" 표시
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  const ymd = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}.`
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${ymd} ${hms}`
}
