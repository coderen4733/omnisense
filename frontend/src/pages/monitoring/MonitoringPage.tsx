import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import { getRunStats } from '../../api/runs'
import type { RunStats } from '../../api/types'
import PageHeader from '../../components/common/PageHeader'
import SelectBox from '../../components/common/SelectBox'
import { formatDuration, RUN_PERIOD_OPTIONS } from '../../constants/run'
import { formatDateTime } from '../../utils/format'
import DailyRunChart from './DailyRunChart'
import RunHistoryTable from './RunHistoryTable'

//  * 모니터링 화면 (/monitoring) - admin, manager
//  - 위: 기간 선택 + 요약 숫자(실행 수, 성공률, 평균 시간, 토큰)
//  - 가운데: 날짜별 실행 수 차트, 워크플로우별 통계, 모델별 사용량
//  - 아래: 실행 기록 목록 (누르면 상세 화면)
//  - 숫자는 모두 워크플로우 실행 기록(서버에 자동 저장됨)으로 계산

// 비율 표시 (예: 87.5 => "87.5%", null => "-")
const formatRate = (rate: number | null) => (rate === null ? '-' : `${rate}%`)

// 성공 / 끝난 실행 => 성공률 (끝난 실행이 없으면 null)
const successRate = (succeeded: number, finished: number) =>
  finished > 0 ? Math.round((succeeded / finished) * 1000) / 10 : null

export default function MonitoringPage() {
  // 1. 기간 (최근 며칠) - 선택 상자 값은 글자이므로 String 으로 저장
  const [days, setDays] = useState('7')

  // 2. 통계 불러오기
  const [stats, setStats] = useState<RunStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getRunStats(Number(days))
      .then((data) => {
        setStats(data)
        setError(null)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  const summary = stats?.summary
  const periodOptions = RUN_PERIOD_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

  return (
    <div className="page">
      <PageHeader
        title="모니터링"
        description="워크플로우 실행 현황, 응답 시간, 토큰 사용량을 확인합니다."
        actions={
          <>
            <SelectBox value={days} options={periodOptions} onChange={setDays} ariaLabel="기간" />
            <button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : undefined} />
              새로고침
            </button>
          </>
        }
      />

      {/* 카드 사이 간격을 주기 위해 세로로 쌓는 틀 (styles/monitoring.css 의 .monitor-stack) */}
      <div className="monitor-stack">
        {error && <section className="card empty-state is-error">{error}</section>}

        {/* 1. 요약 숫자 */}
        <div className="stat-grid">
          <div className="card stat-tile">
            <span className="stat-label">전체 실행</span>
            <strong className="stat-value">{summary ? summary.total.toLocaleString() : '-'}</strong>
            <span className="stat-sub">{summary && summary.running > 0 ? `실행 중 ${summary.running}건` : ' '}</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-label">성공률</span>
            <strong className="stat-value">{summary ? formatRate(summary.success_rate) : '-'}</strong>
            <span className="stat-sub">
              {summary ? `성공 ${summary.succeeded} · 실패 ${summary.failed} · 중지 ${summary.stopped}` : ' '}
            </span>
          </div>
          <div className="card stat-tile">
            <span className="stat-label">평균 걸린 시간</span>
            <strong className="stat-value">{summary ? formatDuration(summary.avg_latency_ms) : '-'}</strong>
            <span className="stat-sub">성공한 실행 기준</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-label">토큰 사용량</span>
            <strong className="stat-value">
              {summary ? (summary.input_tokens + summary.output_tokens).toLocaleString() : '-'}
            </strong>
            <span className="stat-sub">
              {summary
                ? `입력 ${summary.input_tokens.toLocaleString()} · 출력 ${summary.output_tokens.toLocaleString()}`
                : ' '}
            </span>
          </div>
        </div>

        {/* 2. 날짜별 실행 수 */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">날짜별 실행 수</h2>
          </div>
          <div className="card-body">
            {stats ? <DailyRunChart daily={stats.daily} /> : <div className="run-chart-empty">불러오는 중...</div>}
          </div>
        </section>

        {/* 3. 워크플로우별 / 모델별 */}
        <div className="monitor-grid">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">워크플로우별</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>워크플로우</th>
                    <th className="col-right">실행</th>
                    <th className="col-right">성공률</th>
                    <th className="col-right">평균 시간</th>
                    <th className="col-right">토큰</th>
                    <th>마지막 실행</th>
                  </tr>
                </thead>
                <tbody>
                  {!stats || stats.workflows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="table-empty">
                        {stats ? '이 기간에 실행한 워크플로우가 없습니다.' : '불러오는 중...'}
                      </td>
                    </tr>
                  ) : (
                    stats.workflows.map((row) => (
                      <tr key={`${row.workflow_id}-${row.workflow_name}`}>
                        <td className="cell-email">
                          {row.workflow_id !== null ? (
                            <Link to={`/workflows/${row.workflow_id}`}>{row.workflow_name}</Link>
                          ) : (
                            <>
                              {row.workflow_name}
                              <span className="text-muted"> (삭제됨)</span>
                            </>
                          )}
                        </td>
                        <td className="col-right cell-date">{row.total.toLocaleString()}</td>
                        <td className="col-right cell-date">
                          {formatRate(successRate(row.succeeded, row.total))}
                          {row.failed > 0 && <span className="cell-fail"> (실패 {row.failed})</span>}
                        </td>
                        <td className="col-right cell-date">{formatDuration(row.avg_latency_ms)}</td>
                        <td className="col-right cell-date">{row.tokens.toLocaleString()}</td>
                        <td className="cell-date">{formatDateTime(row.last_run_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">모델별 사용량</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>모델</th>
                    <th className="col-right">호출</th>
                    <th className="col-right">토큰 입력</th>
                    <th className="col-right">토큰 출력</th>
                    <th className="col-right">평균 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {!stats || stats.models.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="table-empty">
                        {stats ? '이 기간에 실행한 에이전트가 없습니다.' : '불러오는 중...'}
                      </td>
                    </tr>
                  ) : (
                    stats.models.map((row) => (
                      <tr key={row.model_name}>
                        <td className="cell-email">{row.model_name}</td>
                        <td className="col-right cell-date">
                          {row.calls.toLocaleString()}
                          {row.errors > 0 && <span className="cell-fail"> (오류 {row.errors})</span>}
                        </td>
                        <td className="col-right cell-date">{row.input_tokens.toLocaleString()}</td>
                        <td className="col-right cell-date">{row.output_tokens.toLocaleString()}</td>
                        <td className="col-right cell-date">{formatDuration(row.avg_duration_ms)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="card-note">에이전트 노드 1번 실행 = 호출 1회 (도구를 쓰면 LLM 을 여러 번 부를 수 있음)</p>
          </section>
        </div>

        {/* 4. 실행 기록 목록 */}
        <RunHistoryTable />
      </div>
    </div>
  )
}
