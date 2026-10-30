import { RefreshCw, Search, UserPlus, Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import type { User, UserListResponse, UserRole } from '../../api/types'
import { getUsers, updateUserActive, updateUserRole, USERS_CHANGED_EVENT } from '../../api/users'
import PageHeader from '../../components/common/PageHeader'
import Pagination from '../../components/common/Pagination'
import PillSelect, { type PillOption } from '../../components/common/PillSelect'
import SelectBox, { type SelectOption } from '../../components/common/SelectBox'
import { ROLE_LABEL } from '../../constants/user'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../utils/format'
import CreateUserModal from './CreateUserModal'

// 한 페이지에 보여줄 사용자 수 (백엔드 최대 100)
const PAGE_SIZE = 20

// 1. 활성화 상태 탭 (전체 / 활성화 / 비활성화)
type StatusTab = 'all' | 'active' | 'inactive'

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성화' },
  { value: 'inactive', label: '비활성화' },
]

// 주소의 ?status= 값을 탭 값으로 바꾸기 (잘못된 값이면 '전체')
//  - 헤더 알림(🔔)을 누르면 /settings/users?status=inactive 로 이동 => 비활성화 탭이 열림
function parseStatus(value: string | null): StatusTab {
  return value === 'active' || value === 'inactive' ? value : 'all'
}

// 2. 권한 필터
type RoleFilter = UserRole | 'all'

const ROLE_FILTER_OPTIONS: SelectOption<RoleFilter>[] = [
  { value: 'all', label: '모든 권한' },
  { value: 'admin', label: ROLE_LABEL.admin },
  { value: 'manager', label: ROLE_LABEL.manager },
  { value: 'user', label: ROLE_LABEL.user },
]

// 3. 정렬 (화면의 선택지 => 백엔드 sort_by, order 값)
type SortKey = 'newest' | 'oldest' | 'updated' | 'email'

const SORT_OPTIONS: Record<
  SortKey,
  { label: string; sortBy: 'created_at' | 'updated_at' | 'email'; order: 'asc' | 'desc' }
> = {
  newest: { label: '최신 가입순', sortBy: 'created_at', order: 'desc' },
  oldest: { label: '오래된 가입순', sortBy: 'created_at', order: 'asc' },
  updated: { label: '최근 수정순', sortBy: 'updated_at', order: 'desc' },
  email: { label: '이메일순', sortBy: 'email', order: 'asc' },
}

const SORT_SELECT_OPTIONS: SelectOption<SortKey>[] = (Object.keys(SORT_OPTIONS) as SortKey[]).map(
  (key) => ({ value: key, label: SORT_OPTIONS[key].label }),
)

// 4. 표 안의 알약(pill) 드롭다운 선택지 (색상: 관리자=빨강, 매니저=파랑, 사용자=회색)
const ROLE_PILL_OPTIONS: PillOption<UserRole>[] = [
  { value: 'admin', label: ROLE_LABEL.admin, tone: 'red' },
  { value: 'manager', label: ROLE_LABEL.manager, tone: 'blue' },
  { value: 'user', label: ROLE_LABEL.user, tone: 'gray' },
]

type ActiveValue = 'active' | 'inactive'

const ACTIVE_PILL_OPTIONS: PillOption<ActiveValue>[] = [
  { value: 'active', label: '활성화', tone: 'green' },
  { value: 'inactive', label: '비활성화', tone: 'orange' },
]

//  * 사용자·권한 관리 화면 (admin, manager 전용)
//  - 목록 조회: GET /users/ (필터 + 정렬 + 페이지)
//  - 권한 변경: PATCH /users/{id}/role   (admin만)
//  - 활성화 변경: PATCH /users/{id}/active (admin: 모든 계정 / manager: 일반 사용자 계정만)
//  - 사용자 생성: POST /users/ (admin만)
export default function UsersPage() {
  const { user: me } = useAuth()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const status = parseStatus(searchParams.get('status'))

  // 1. 검색 조건
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [emailInput, setEmailInput] = useState('') // 검색창에 입력 중인 값
  const [emailKeyword, setEmailKeyword] = useState('') // 실제 검색에 쓰는 값 (검색 버튼/Enter 시 반영)
  const [sortKey, setSortKey] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)

  // 2. 화면 상태
  const [result, setResult] = useState<UserListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [inactiveCount, setInactiveCount] = useState(0) // "비활성화" 탭 옆 숫자
  const [reloadKey, setReloadKey] = useState(0) // 값을 바꾸면 목록을 다시 불러옴 (새로고침)
  const [updatingId, setUpdatingId] = useState<number | null>(null) // 변경 요청 중인 사용자 id
  const [createOpen, setCreateOpen] = useState(false) // 사용자 생성 팝업 열림 여부

  const isAdmin = me?.role === 'admin'

  // 3. 상태 탭이 바뀌면 1페이지부터 다시 보기 (헤더 알림 버튼으로 이동한 경우 포함)
  useEffect(() => {
    setPage(1)
  }, [status])

  // 4. 검색 조건이 바뀔 때마다 사용자 목록 불러오기
  useEffect(() => {
    // ignore: 조건이 빠르게 여러 번 바뀌면, 늦게 도착한 "이전 조건의 응답"은 무시하기 위함
    let ignore = false
    const sort = SORT_OPTIONS[sortKey]
    setLoading(true)

    getUsers({
      // 전체 탭이면 undefined => 쿼리에서 빠짐 => 활성화 여부로 거르지 않음
      is_active: status === 'all' ? undefined : status === 'active',
      role: roleFilter === 'all' ? undefined : roleFilter,
      email: emailKeyword || undefined,
      sort_by: sort.sortBy,
      order: sort.order,
      page,
      size: PAGE_SIZE,
    })
      .then((data) => {
        if (!ignore) {
          setResult(data)
          setErrorMessage(null)
        }
      })
      .catch((error) => {
        if (!ignore) {
          setErrorMessage(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [status, roleFilter, emailKeyword, sortKey, page, reloadKey])

  // 5. "비활성화" 탭 옆 숫자 불러오기 (새로고침하거나, 사용자 정보가 바뀌면 다시 불러옴)
  useEffect(() => {
    let ignore = false
    const load = () => {
      getUsers({ is_active: false, size: 1 })
        .then((data) => {
          if (!ignore) {
            setInactiveCount(data.total)
          }
        })
        .catch(() => {
          // 숫자 표시는 부가 기능이므로 실패해도 에러를 띄우지 않음
        })
    }
    load()
    window.addEventListener(USERS_CHANGED_EVENT, load)
    return () => {
      ignore = true
      window.removeEventListener(USERS_CHANGED_EVENT, load)
    }
  }, [reloadKey])

  // 6. 검색 조건 변경 함수들 (조건이 바뀌면 1페이지부터)
  const handleStatusChange = (next: StatusTab) => {
    // 탭 값은 주소(?status=)에 저장 => 새로고침해도 같은 탭 유지 (페이지는 3번 effect가 1로 바꿈)
    setSearchParams(next === 'all' ? {} : { status: next })
  }

  const handleRoleFilterChange = (next: RoleFilter) => {
    setRoleFilter(next)
    setPage(1)
  }

  const handleSortChange = (next: SortKey) => {
    setSortKey(next)
    setPage(1)
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setEmailKeyword(emailInput.trim())
    setPage(1)
  }

  const handleRefresh = () => {
    setReloadKey((prev) => prev + 1)
  }

  // 7. 변경 권한 확인 (백엔드 규칙과 똑같이 맞춤 - 화면에서 미리 막아서 불필요한 403을 줄임)
  //  - 권한 변경: admin만 가능, 자기 자신은 불가
  const canEditRole = (target: User) => isAdmin && target.id !== me?.id
  //  - 활성화 변경: 자기 자신은 불가 / manager는 일반 사용자(user) 계정만 가능
  const canEditActive = (target: User) =>
    target.id !== me?.id && (isAdmin || (me?.role === 'manager' && target.role === 'user'))

  // 8. 변경에 성공하면 목록에서 해당 사용자만 새 정보로 교체 (목록 전체를 다시 불러오지 않음)
  const replaceUser = (updated: User) => {
    setResult((prev) =>
      prev
        ? { ...prev, items: prev.items.map((item) => (item.id === updated.id ? updated : item)) }
        : prev,
    )
  }

  // 9. 권한 변경
  const changeUserRole = async (target: User, role: UserRole) => {
    setUpdatingId(target.id)
    try {
      const updated = await updateUserRole(target.id, role)
      replaceUser(updated)
      showToast(`${target.email} 계정의 권한을 '${ROLE_LABEL[role]}'(으)로 변경했습니다.`)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  // 10. 활성화 상태 변경
  const changeUserActive = async (target: User, value: ActiveValue) => {
    const isActive = value === 'active'
    setUpdatingId(target.id)
    try {
      const updated = await updateUserActive(target.id, isActive)
      replaceUser(updated)
      showToast(`${target.email} 계정을 ${isActive ? '활성화' : '비활성화'}했습니다.`)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  // 11. 표 본문 그리기 (에러 / 처음 불러오는 중 / 결과 없음 / 사용자 목록)
  const renderRows = () => {
    if (errorMessage) {
      return (
        <tr>
          <td colSpan={6} className="table-empty is-error">
            {errorMessage}
          </td>
        </tr>
      )
    }
    if (!result) {
      return (
        <tr>
          <td colSpan={6} className="table-empty">
            불러오는 중...
          </td>
        </tr>
      )
    }
    if (result.items.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="table-empty">
            조건에 맞는 사용자가 없습니다.
          </td>
        </tr>
      )
    }
    return result.items.map((user) => (
      <tr key={user.id}>
        <td className="col-id">{user.id}</td>
        <td>
          <span className="cell-email">{user.email}</span>
          {user.id === me?.id && <span className="me-badge">나</span>}
        </td>
        <td className="col-center">
          <PillSelect
            value={user.role}
            options={ROLE_PILL_OPTIONS}
            editable={canEditRole(user)}
            disabled={updatingId === user.id}
            onChange={(role) => changeUserRole(user, role)}
            ariaLabel={`${user.email} 권한 변경`}
          />
        </td>
        <td className="col-center">
          <PillSelect
            value={user.is_active ? 'active' : 'inactive'}
            options={ACTIVE_PILL_OPTIONS}
            editable={canEditActive(user)}
            disabled={updatingId === user.id}
            onChange={(value) => changeUserActive(user, value)}
            ariaLabel={`${user.email} 활성화 상태 변경`}
          />
        </td>
        <td className="cell-date">{formatDateTime(user.created_at)}</td>
        <td className="cell-date">{formatDateTime(user.updated_at)}</td>
      </tr>
    ))
  }

  const total = result?.total ?? 0
  const totalPages = Math.max(result?.total_pages ?? 1, 1)

  return (
    <div className="page">
      <PageHeader
        title="사용자·권한 관리"
        description="사용자 계정의 권한 및 활성화 상태를 관리합니다."
        actions={
          isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <UserPlus size={18} />
              사용자 생성
            </button>
          )
        }
      />

      <section className="card">
        {/* 카드 제목: 사용자 목록 + 전체 수 + 새로고침 */}
        <div className="card-header">
          <h2 className="card-title">
            <Users size={20} />
            사용자 목록
            <span className="count-chip">{total}</span>
          </h2>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : undefined} />
            새로고침
          </button>
        </div>

        {/* 검색 조건: 상태 탭 / 권한 / 이메일 검색 / 정렬 */}
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="활성화 상태">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={status === tab.value}
                className={status === tab.value ? 'is-active' : undefined}
                onClick={() => handleStatusChange(tab.value)}
              >
                {tab.label}
                {tab.value === 'inactive' && inactiveCount > 0 && (
                  <span className="tab-count">{inactiveCount}</span>
                )}
              </button>
            ))}
          </div>

          <SelectBox
            value={roleFilter}
            options={ROLE_FILTER_OPTIONS}
            onChange={handleRoleFilterChange}
            ariaLabel="권한 필터"
          />

          <form className="search-form" onSubmit={handleSearch} role="search">
            <input
              className="input search-input"
              type="search"
              placeholder="이메일 검색"
              maxLength={50}
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              aria-label="이메일 검색"
            />
            <button type="submit" className="btn btn-outline">
              <Search size={18} />
              검색
            </button>
          </form>

          <SelectBox
            value={sortKey}
            options={SORT_SELECT_OPTIONS}
            onChange={handleSortChange}
            ariaLabel="정렬 기준"
          />
        </div>

        {/* 사용자 표 */}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-id">ID</th>
                <th>이메일</th>
                <th className="col-center">권한</th>
                <th className="col-center">활성화</th>
                <th>가입일</th>
                <th>수정일</th>
              </tr>
            </thead>
            <tbody>{renderRows()}</tbody>
          </table>
        </div>

        {/* 표 아래: 전체 건수 + 페이지 이동 */}
        <div className="table-footer">
          <span>
            전체 <strong>{total}</strong>건 · {page} / {totalPages} 페이지
          </span>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </section>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleRefresh}
      />
    </div>
  )
}
