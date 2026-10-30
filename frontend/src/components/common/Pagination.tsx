import { ChevronLeft, ChevronRight } from 'lucide-react'

//  * 페이지 번호 버튼 ( <  1  2  3  > )
//  - page: 현재 페이지 / totalPages: 전체 페이지 수 / onChange: 다른 페이지를 눌렀을 때

interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

// 한 번에 보여줄 페이지 번호 개수 (예: 5 => 3 4 [5] 6 7)
const MAX_VISIBLE_PAGES = 5

export default function Pagination({ page, totalPages, onChange }: PaginationProps) {
  // 사용자가 0명이어도 "1페이지"는 보여줌
  const lastPage = Math.max(totalPages, 1)

  // 1. 보여줄 페이지 번호 범위 계산 (현재 페이지가 가운데 오도록)
  let start = Math.max(1, page - Math.floor(MAX_VISIBLE_PAGES / 2))
  const end = Math.min(lastPage, start + MAX_VISIBLE_PAGES - 1)
  // 끝 쪽에 가까우면 시작 번호를 앞으로 당겨서 항상 최대 개수만큼 보여줌
  start = Math.max(1, end - MAX_VISIBLE_PAGES + 1)

  // 2. [start, start+1, ..., end] 배열 만들기
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index)

  return (
    <nav className="pagination" aria-label="페이지 이동">
      <button
        type="button"
        className="page-btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="이전 페이지"
      >
        <ChevronLeft size={18} />
      </button>
      {pages.map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          className={pageNumber === page ? 'page-btn is-active' : 'page-btn'}
          onClick={() => onChange(pageNumber)}
          aria-current={pageNumber === page ? 'page' : undefined}
        >
          {pageNumber}
        </button>
      ))}
      <button
        type="button"
        className="page-btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= lastPage}
        aria-label="다음 페이지"
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  )
}
