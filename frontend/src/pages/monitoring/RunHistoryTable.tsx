import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import { getRuns } from '../../api/runs'
import type { RunStatus, RunSummary, WorkflowSummary } from '../../api/types'
import { getWorkflows } from '../../api/workflows'
import Pagination from '../../components/common/Pagination'
import SelectBox, { type SelectOption } from '../../components/common/SelectBox'
import { formatDuration, RUN_STATUS_META, RUN_STATUS_OPTIONS } from '../../constants/run'
import { formatDateTime } from '../../utils/format'

//  * 실행 기록 목록 (모니터링 화면 아래쪽)
//  - 워크플로우, 상태로 거르고 페이지 단위로 봄 (최근 실행 순서)
//  - 줄을 누르면 실행 기록 상세 화면으로 이동

// 한 페이지에 보여줄 기록 수
const PAGE_SIZE = 20

// 선택 상자에서 "전체"를 뜻하는 값 (선택 상자 값은 글자여야 해서 빈 글자 사용)
const ALL = ''

// 오류 메시지는 표에서 앞부분만
const shorten = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max)}…` : text)

export default function RunHistoryTable() {
  const navigate = useNavigate()

  // 1. 거르기 조건 + 페이지
  const [workflowFilter, setWorkflowFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState<RunStatus | typeof ALL>(ALL)
  const [page, setPage] = useState(1)

  // 2. 워크플로우 선택지 (지워진 워크플로우의 기록은 "전체"에서만 볼 수 있음)
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  useEffect(() => {
    getWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]))
  }, [])

  // 3. 기록 목록 불러오기
  const [items, setItems] = useState<RunSummary[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getRuns({
      workflow_id: workflowFilter ? Number(workflowFilter) : undefined,
      status: statusFilter || undefined,
      page,
      size: PAGE_SIZE,
    })
      .then((data) => {
        setItems(data.items)
        setTotal(data.total)
        setTotalPages(Math.max(1, data.total_pages))
        setError(null)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [workflowFilter, statusFilter, page])

  useEffect(() => {
    load()
  }, [load])

  // 거르기 조건을 바꾸면 1페이지부터
  const changeWorkflow = (value: string) => {
    setWorkflowFilter(value)
    setPage(1)
  }
  const changeStatus = (value: RunStatus | typeof ALL) => {
    setStatusFilter(value)
    setPage(1)
  }

  const workflowOptions: SelectOption<string>[] = [
    { value: ALL, label: '모든 워크플로우' },
    ...workflows.map((workflow) => ({ value: String(workflow.id), label: workflow.name })),
  ]
  const statusOptions: SelectOption<RunStatus | typeof ALL>[] = [{ value: ALL, label: '모든 상태' }, ...RUN_STATUS_OPTIONS]

  // 표 내용 (불러오는 중 / 오류 / 없음 / 목록)
  const renderRows = () => {
    if (error) {
      return (
        <tr>
          <td colSpan={8} className="table-empty is-error">
            {error}
          </td>
        </tr>
      )
    }
    if (items.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="table-empty">
            {loading ? '불러오는 중...' : '실행 기록이 없습니다.'}
          </td>
        </tr>
      )
    }
    return items.map((run) => {
      const meta = RUN_STATUS_META[run.status]
      return (
        <tr key={run.id} className="row-link" onClick={() => navigate(`/monitoring/runs/${run.id}`)}>
          <td className="col-id">{run.id}</td>
          <td className="cell-email">
            {run.workflow_name}
            {run.workflow_id === null && <span className="text-muted"> (삭제됨)</span>}
          </td>
          <td className="col-center">
            <span className={`pill pill-sm pill-${meta.tone}`}>{meta.label}</span>
          </td>
          <td className="cell-error" title={run.error ?? undefined}>
            {run.error ? shorten(run.error) : ''}
          </td>
          <td>{run.started_by_email ?? '-'}</td>
          <td className="cell-date">{formatDateTime(run.started_at)}</td>
          <td className="col-right cell-date">{formatDuration(run.latency_ms)}</td>
          <td className="col-right cell-date">{(run.input_tokens + run.output_tokens).toLocaleString()}</td>
        </tr>
      )
    })
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">실행 기록</h2>
        <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : undefined} />
          새로고침
        </button>
      </div>

      <div className="toolbar">
        <SelectBox value={workflowFilter} options={workflowOptions} onChange={changeWorkflow} ariaLabel="워크플로우 필터" />
        <SelectBox value={statusFilter} options={statusOptions} onChange={changeStatus} ariaLabel="상태 필터" />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-id">번호</th>
              <th>워크플로우</th>
              <th className="col-center">상태</th>
              <th>오류</th>
              <th>실행한 사용자</th>
              <th>시작 시각</th>
              <th className="col-right">걸린 시간</th>
              <th className="col-right">토큰</th>
            </tr>
          </thead>
          <tbody>{renderRows()}</tbody>
        </table>
      </div>

      <div className="table-footer">
        <span>
          전체 <strong>{total.toLocaleString()}</strong>건 · {page} / {totalPages} 페이지
        </span>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </section>
  )
}
