import type { LlmProviderType } from '../api/types'
import type { SelectOption } from '../components/common/SelectBox'

// 연결 방식 => 화면에 보여줄 이름
export const PROVIDER_TYPE_LABEL: Record<LlmProviderType, string> = {
  openai_compatible: 'OpenAI 호환',
  bedrock: 'AWS Bedrock',
}

//  * 공급자 등록 화면의 연결 방식 선택지
export const PROVIDER_TYPE_OPTIONS: SelectOption<LlmProviderType>[] = [
  { value: 'openai_compatible', label: 'OpenAI 호환 (Ollama, vLLM)' },
  { value: 'bedrock', label: 'AWS Bedrock' },
]

// 공급자 주소 입력창의 예시 문구 (실제 접속 주소는 화면에서 관리자가 입력)
export const BASE_URL_PLACEHOLDER = '예) http://localhost:11434/v1'

// AWS 리전 입력창의 예시 문구
export const REGION_PLACEHOLDER = '예) ap-northeast-2'

// 모델 ID 입력창의 예시 문구 (연결 방식마다 모델 ID 형식이 다름)
//  - Bedrock은 교차 리전 추론 ID를 사용 (서울 리전 예: global. 으로 시작)
export const MODEL_ID_PLACEHOLDER: Record<LlmProviderType, string> = {
  openai_compatible: '예) qwen3.5:9b',
  bedrock: '예) global.amazon.nova-2-lite-v1:0',
}
