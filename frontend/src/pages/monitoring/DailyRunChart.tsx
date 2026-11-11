import { useState } from 'react'

import type { RunStats } from '../../api/types'

//  * 날짜별 실행 수 차트 (쌓은 막대 - 아래부터 성공 / 실패 / 중지)
//  - 차트 라이브러리 없이 HTML + CSS 로 그림 (가벼움, 폐쇄망 대비 - styles/monitoring.css 의 .run-chart)
//  - 색은 styles/monitoring.css 의 --chart-xxx 변수 (라이트/다크 모드 각각 색맹 구분 검사를 통과한 색)
//  - 색만으로 구분하지 않도록: 위쪽 범례 + 막대에 마우스를 올리면(또는 Tab 키로 이동하면) 숫자 표시
//    + "표로 보기"로 숫자를 표로도 볼 수 있음

type DailyRow = RunStats['daily'][number]

// 막대에 쌓는 순서 (아래 => 위)와 이름
const SERIES = [
  { key: 'succeeded', label: '성공', className: 'is-succeeded' },
  { key: 'failed', label: '실패', className: 'is-failed' },
  { key: 'stopped', label: '중지', className: 'is-stopped' },
] as const

//  * 세로축 최댓값을 보기 좋은 숫자로 올림 (예: 7 => 8, 13 => 15, 230 => 250)
//  - 1, 2, 2.5, 5, 10 의 배수 중 가장 가까운 큰 값
function niceMax(value: number): number {
  if (value <= 4) {
    return 4
  }
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) {
      return step * magnitude
    }
  }
  return 10 * magnitude
}

// "2026-11-11" => "11/11"
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

export default function DailyRunChart({ daily }: { daily: DailyRow[] }) {
  // 마우스를 올린(또는 키보드로 선택한) 날짜의 순서 (없으면 null)
  const [active, setActive] = useState<number | null>(null)

  const peak = Math.max(0, ...daily.map((row) => row.succeeded + row.failed + row.stopped))
  const max = niceMax(peak)
  // 날짜 글자가 겹치지 않도록 최대 10개 정도만 표시 (예: 30일 => 3일마다)
  const labelEvery = Math.ceil(daily.length / 10)

  if (peak === 0) {
    return <div className="run-chart-empty">이 기간에 실행한 기록이 없습니다.</div>
  }

  return (
    <div className="run-chart">
      {/* 범례 (2개 이상의 색을 쓰므로 항상 표시) */}
      <ul className="run-chart-legend">
        {SERIES.map((series) => (
          <li key={series.key}>
            <span className={`run-chart-swatch ${series.className}`} />
            {series.label}
          </li>
        ))}
      </ul>

      <div className="run-chart-plot">
        {/* 세로축 눈금 (0, 절반, 최댓값) + 가로 보조선 */}
        <div className="run-chart-grid" aria-hidden="true">
          {[max, max / 2, 0].map((tick) => (
            <div key={tick} className="run-chart-gridline">
              <span>{tick.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* 날짜별 막대 */}
        <div className="run-chart-bars">
          {daily.map((row, index) => {
            const counted = row.succeeded + row.failed + row.stopped
            const summary = `${row.date} 실행 ${row.total}회 (성공 ${row.succeeded}, 실패 ${row.failed}, 중지 ${row.stopped})`
            return (
              // 막대 칸 전체(위아래 끝까지)가 마우스 대상 => 낮은 막대도 쉽게 가리킬 수 있음
              <div
                key={row.date}
                className={active === index ? 'run-chart-col is-active' : 'run-chart-col'}
                tabIndex={0}
                aria-label={summary}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                {/* 쌓은 막대 (높이: 전체 높이 대비 비율 %) */}
                <div className="run-chart-stack" style={{ height: `${(counted / max) * 100}%` }}>
                  {SERIES.map((series) =>
                    row[series.key] > 0 ? (
                      <div
                        key={series.key}
                        className={`run-chart-seg ${series.className}`}
                        style={{ flexGrow: row[series.key] }}
                      />
                    ) : null,
                  )}
                </div>

                {/* 숫자 말풍선 (마우스를 올렸을 때) */}
                {active === index && (
                  <div className={index > daily.length / 2 ? 'run-chart-tip is-left' : 'run-chart-tip'} role="tooltip">
                    <strong>{row.date}</strong>
                    <span>실행 {row.total.toLocaleString()}회</span>
                    {SERIES.map((series) => (
                      <span key={series.key}>
                        <i className={`run-chart-swatch ${series.className}`} />
                        {series.label} {row[series.key].toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 가로축 날짜 */}
      <div className="run-chart-axis" aria-hidden="true">
        {daily.map((row, index) => (
          <span key={row.date}>{index % labelEvery === 0 || index === daily.length - 1 ? shortDate(row.date) : ''}</span>
        ))}
      </div>

      {/* 표로 보기 (색을 구분하기 어렵거나 정확한 숫자가 필요할 때) */}
      <details className="run-chart-table">
        <summary>표로 보기</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th className="col-right">실행</th>
              <th className="col-right">성공</th>
              <th className="col-right">실패</th>
              <th className="col-right">중지</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td className="col-right">{row.total}</td>
                <td className="col-right">{row.succeeded}</td>
                <td className="col-right">{row.failed}</td>
                <td className="col-right">{row.stopped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
