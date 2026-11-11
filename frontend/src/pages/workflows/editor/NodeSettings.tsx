import { CircleAlert, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'

import type { Agent, ConditionOperator, StartInput } from '../../../api/types'
import SelectBox, { type SelectOption } from '../../../components/common/SelectBox'
import { INPUT_KEY_PATTERN, NODE_META, OPERATOR_OPTIONS, UNARY_OPERATORS } from '../../../constants/workflow'
import type {
  AgentFlowNode,
  ConditionFlowNode,
  EndFlowNode,
  StartFlowNode,
  TemplateVariable,
  WorkflowFlowNode,
} from './flow'

//  * 오른쪽 설정 패널 - 선택한 노드의 설정값을 고치는 곳
//  - 값을 고치면 onChange(바뀐 값)를 호출 => 편집 화면이 노드의 data에 반영
//  - readOnly: 일반 사용자(user)는 보기만 가능 (fieldset disabled => 안의 입력칸이 모두 비활성화)

interface NodeSettingsProps {
  node: WorkflowFlowNode
  variables: TemplateVariable[] // 이 노드에서 {{ }} 로 꺼내 쓸 수 있는 앞 노드 항목
  agents: Agent[]
  issues: string[] // 이 노드의 문제 (마지막 저장 기준)
  readOnly: boolean
  onChange: (patch: Record<string, unknown>) => void
  onDelete: () => void
}

export default function NodeSettings({
  node,
  variables,
  agents,
  issues,
  readOnly,
  onChange,
  onDelete,
}: NodeSettingsProps) {
  const meta = NODE_META[node.type]
  const Icon = meta.icon

  return (
    <div className="wf-settings">
      <div className="wf-settings-header">
        <span className={`wf-node-icon tone-${meta.tone}`}>
          <Icon size={16} />
        </span>
        <div className="wf-settings-heading">
          <strong>{meta.label} 노드 설정</strong>
          <code className="code">{node.id}</code>
        </div>
        {/* 시작 노드는 지울 수 없음 (워크플로우마다 1개 필요) */}
        {!readOnly && node.type !== 'start' && (
          <button type="button" className="icon-btn is-danger" onClick={onDelete} aria-label="노드 삭제" title="노드 삭제">
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="wf-settings-issues">
          {issues.map((message) => (
            <li key={message}>
              <CircleAlert size={14} />
              {message}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="wf-fieldset form-stack" disabled={readOnly}>
        <label className="field">
          <span className="field-label">노드 이름</span>
          <input
            className="input"
            maxLength={50}
            value={node.data.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>

        {node.type === 'start' && <StartSettings node={node} onChange={onChange} />}
        {node.type === 'agent' && (
          <AgentSettings node={node} agents={agents} variables={variables} onChange={onChange} />
        )}
        {node.type === 'condition' && <ConditionSettings node={node} variables={variables} onChange={onChange} />}
        {node.type === 'end' && <EndSettings node={node} variables={variables} onChange={onChange} />}
      </fieldset>
    </div>
  )
}

//  * {{ }} 를 쓸 수 있는 입력칸 + "앞 노드 값 넣기" 버튼 목록
//  - 버튼을 누르면 커서 위치에 {{노드ID.항목}} 을 끼워 넣음
interface TemplateFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  variables: TemplateVariable[]
  rows?: number
  placeholder?: string
  hint?: string
  maxLength: number
}

function TemplateField({ label, value, onChange, variables, rows = 4, placeholder, hint, maxLength }: TemplateFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 커서 위치(선택 영역)에 글자 끼워 넣기 (입력칸을 누른 적이 없으면 맨 끝에)
  const insert = (text: string) => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? value.length
    const end = textarea?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + text + value.slice(end))
    // 다음 화면 그리기 후 커서를 끼워 넣은 글자 뒤로 옮김
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <textarea
        ref={textareaRef}
        className="input textarea"
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {variables.length > 0 ? (
        <div className="wf-variables">
          <span className="wf-variables-title">앞 노드 값 넣기</span>
          {variables.map((variable) => (
            <button
              key={variable.ref}
              type="button"
              className="chip"
              onClick={() => insert(variable.ref)}
              title={variable.ref}
            >
              {variable.nodeLabel} · {variable.label}
            </button>
          ))}
        </div>
      ) : (
        <span className="field-hint">앞 노드와 연결하면 앞 노드의 값을 넣을 수 있습니다.</span>
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

// ===== 1. 시작 노드: 입력 칸 목록 편집 =====
function StartSettings({ node, onChange }: { node: StartFlowNode; onChange: NodeSettingsProps['onChange'] }) {
  const inputs = node.data.inputs

  // 입력 칸 1개의 값 바꾸기 (나머지 칸은 그대로)
  const updateInput = (index: number, patch: Partial<StartInput>) => {
    onChange({ inputs: inputs.map((item, i) => (i === index ? { ...item, ...patch } : item)) })
  }

  // 입력 칸 추가 (이름은 겹치지 않게 input_1, input_2 ...)
  const addInput = () => {
    let number = inputs.length + 1
    while (inputs.some((item) => item.key === `input_${number}`)) {
      number += 1
    }
    onChange({
      inputs: [...inputs, { key: `input_${number}`, label: `입력 ${number}`, type: 'text', required: true }],
    })
  }

  return (
    <div className="field">
      <span className="field-label">입력 칸</span>
      <span className="field-hint">
        실행할 때 사용자가 채울 칸입니다. 다른 노드에서 {'{{'}
        {node.id}.이름{'}}'} 로 꺼내 씁니다.
      </span>
      {inputs.map((input, index) => {
        const keyInvalid = !INPUT_KEY_PATTERN.test(input.key)
        const keyDuplicated = inputs.some((other, i) => i !== index && other.key === input.key)
        return (
          <div key={index} className="wf-input-row">
            <div className="wf-input-grid">
              <input
                className="input"
                placeholder="표시 이름 (예: 질문)"
                maxLength={50}
                value={input.label}
                onChange={(event) => updateInput(index, { label: event.target.value })}
                aria-label="표시 이름"
              />
              <input
                className="input"
                placeholder="이름 (예: question)"
                maxLength={50}
                value={input.key}
                onChange={(event) => updateInput(index, { key: event.target.value.trim() })}
                aria-label="이름"
              />
              <SelectBox
                value={input.type}
                options={[
                  { value: 'text', label: '글자' },
                  { value: 'number', label: '숫자' },
                ]}
                onChange={(value) => updateInput(index, { type: value })}
                ariaLabel="입력 종류"
                className="select-block"
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={input.required}
                  onChange={(event) => updateInput(index, { required: event.target.checked })}
                />
                <span>필수</span>
              </label>
            </div>
            <button
              type="button"
              className="icon-btn is-danger"
              onClick={() => onChange({ inputs: inputs.filter((_, i) => i !== index) })}
              aria-label="입력 칸 삭제"
              title="입력 칸 삭제"
            >
              <Trash2 size={16} />
            </button>
            {(keyInvalid || keyDuplicated) && (
              <span className="field-hint is-warning wf-input-error">
                {keyInvalid ? '이름은 영문, 숫자, _, 한글만 쓸 수 있습니다. (공백 불가)' : '이름이 다른 입력 칸과 겹칩니다.'}
              </span>
            )}
          </div>
        )
      })}
      <button type="button" className="btn btn-outline btn-sm" onClick={addInput} disabled={inputs.length >= 20}>
        <Plus size={16} />
        입력 칸 추가
      </button>
    </div>
  )
}

// ===== 2. 에이전트 노드: 에이전트 선택 + 보낼 내용 =====
interface AgentSettingsProps {
  node: AgentFlowNode
  agents: Agent[]
  variables: TemplateVariable[]
  onChange: NodeSettingsProps['onChange']
}

function AgentSettings({ node, agents, variables, onChange }: AgentSettingsProps) {
  const selectedId = node.data.agent_id
  //  * 선택지: "사용" 상태인 에이전트 + 지금 선택된 에이전트(사용 안 함이어도 목록에 남김)
  const options: SelectOption<string>[] = [
    { value: '', label: '에이전트를 선택해 주세요', disabled: true },
    ...agents
      .filter((agent) => agent.is_active || agent.id === selectedId)
      .map((agent) => ({ value: String(agent.id), label: agent.is_active ? agent.name : `${agent.name} (사용 안 함)` })),
  ]
  // 저장된 에이전트가 삭제된 경우: 선택지에 없으므로 '' (선택 안 됨)로 표시
  const value = selectedId !== null && options.some((option) => option.value === String(selectedId)) ? String(selectedId) : ''

  return (
    <>
      <div className="field">
        <span className="field-label">실행할 에이전트</span>
        <SelectBox
          value={value}
          options={options}
          onChange={(next) => onChange({ agent_id: Number(next) })}
          ariaLabel="에이전트 선택"
          className="select-block"
        />
        {selectedId !== null && (
          <Link to={`/agents/${selectedId}`} className="text-btn wf-agent-link" target="_blank">
            이 에이전트 테스트 실행 열기
          </Link>
        )}
        {agents.length === 0 && (
          <span className="field-hint">등록된 에이전트가 없습니다. 에이전트 메뉴에서 먼저 만들어 주세요.</span>
        )}
      </div>
      <TemplateField
        label="에이전트에 보낼 내용"
        value={node.data.prompt}
        onChange={(prompt) => onChange({ prompt })}
        variables={variables}
        rows={5}
        maxLength={20000}
        placeholder="예) {{start.question}}"
        hint="에이전트에게 사용자 질문처럼 전달됩니다. 에이전트의 답변은 다음 노드에서 '답변'으로 꺼내 쓸 수 있습니다."
      />
    </>
  )
}

// ===== 3. 조건 분기 노드: 비교할 값 + 비교 방법 + 기준 값 =====
interface ConditionSettingsProps {
  node: ConditionFlowNode
  variables: TemplateVariable[]
  onChange: NodeSettingsProps['onChange']
}

function ConditionSettings({ node, variables, onChange }: ConditionSettingsProps) {
  const unary = UNARY_OPERATORS.includes(node.data.operator)
  return (
    <>
      <TemplateField
        label="비교할 값"
        value={node.data.left}
        onChange={(left) => onChange({ left })}
        variables={variables}
        rows={2}
        maxLength={2000}
        placeholder="예) {{start.amount}}"
      />
      <div className="field">
        <span className="field-label">비교 방법</span>
        <SelectBox
          value={node.data.operator}
          options={OPERATOR_OPTIONS}
          onChange={(operator: ConditionOperator) => onChange({ operator })}
          ariaLabel="비교 방법"
          className="select-block"
        />
      </div>
      {!unary && (
        <TemplateField
          label="기준 값"
          value={node.data.right}
          onChange={(right) => onChange({ right })}
          variables={variables}
          rows={2}
          maxLength={2000}
          placeholder="예) 1000000"
        />
      )}
      <span className="field-hint">
        조건이 맞으면 '참' 쪽, 맞지 않으면 '거짓' 쪽으로 이어집니다. 숫자 비교(&gt;, ≥, &lt;, ≤)는 두 값을 숫자로
        바꿔서 비교합니다.
      </span>
    </>
  )
}

// ===== 4. 끝 노드: 최종 출력 =====
function EndSettings({
  node,
  variables,
  onChange,
}: {
  node: EndFlowNode
  variables: TemplateVariable[]
  onChange: NodeSettingsProps['onChange']
}) {
  return (
    <TemplateField
      label="출력"
      value={node.data.output}
      onChange={(output) => onChange({ output })}
      variables={variables}
      rows={6}
      maxLength={20000}
      placeholder="예) {{agent_1.answer}}"
      hint="워크플로우 실행이 이 노드에 도착하면 이 내용이 최종 결과가 됩니다."
    />
  )
}
