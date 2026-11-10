#  * 기본 내장 도구 (에이전트가 호출할 수 있는 도구 중 "서버 안에 직접 만든" 도구)
#  - 외부 접속 없이 서버 안에서만 동작하는 안전한 도구만 둠
#  - 에이전트의 도구 호출 과정(질문 => 도구 실행 => 결과로 답변)이 잘 동작하는지 확인하는 용도
#  - 외부 도구는 나중에 MCP 서버를 연결해서 추가 (registry.py 에 같은 방식으로 등록)
#
# 📌 도구 함수 작성 규칙
#  - 매개변수: 모델이 보낸 값(dict) / 반환값: 모델에게 돌려줄 결과(문자열, 보통 JSON)
#  - 잘못된 값이 오면 ToolError를 던짐
#    => 오류 내용이 모델에게 전달되어, 모델이 값을 고쳐서 다시 시도할 수 있음

import ast  # 파이썬 식을 "실행하지 않고" 구조(트리)로 분석하는 도구 - 계산기에서 사용
import json
import math
import operator  # +, -, * 같은 연산을 함수로 쓸 수 있게 해주는 표준 라이브러리
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError  # 시간대(예: Asia/Seoul) 정보


# 도구 실행 실패 (모델이 잘못된 값을 보낸 경우 등) - 메시지는 모델과 화면에 그대로 전달됨
class ToolError(Exception):
    pass


# 결과(dict) => JSON 문자열 (ensure_ascii=False: 한글을 \uXXXX 로 바꾸지 않음)
def _to_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


# ============================================================
# 1. 현재 시각 (get_current_time)
# ============================================================

# 시간대를 보내지 않았을 때 사용하는 기본 시간대
DEFAULT_TIMEZONE = "Asia/Seoul"

#  * 기본 시간대 정보가 서버에 없을 때 대신 쓰는 값 (한국 표준시 = UTC+9)
#  - 시간대 정보는 운영체제(/usr/share/zoneinfo)에서 읽어오는데,
#    일부 가벼운 서버 이미지에는 이 정보가 없을 수 있음 (폐쇄망 대비)
_DEFAULT_TIMEZONE_FALLBACK = timezone(timedelta(hours=9), "KST")

_WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


async def get_current_time(arguments: dict[str, Any]) -> str:
    # 1. 시간대 확인 (보내지 않았으면 기본 시간대)
    timezone_name = arguments.get("timezone") or DEFAULT_TIMEZONE
    if not isinstance(timezone_name, str):
        raise ToolError("timezone은 문자열이어야 합니다. (예: Asia/Seoul)")

    # 2. 시간대 정보 불러오기
    #  - ValueError: "../etc" 처럼 시간대 이름 형식이 아닌 값
    tz: ZoneInfo | timezone
    try:
        tz = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError) as err:
        if timezone_name != DEFAULT_TIMEZONE:
            raise ToolError(
                f"알 수 없는 시간대입니다: {timezone_name} (예: Asia/Seoul, UTC, America/New_York)"
            ) from err
        tz = _DEFAULT_TIMEZONE_FALLBACK

    # 3. 현재 시각 계산 + 결과 만들기
    now = datetime.now(tz)
    return _to_json(
        {
            "timezone": timezone_name,
            "datetime": now.isoformat(timespec="seconds"),  # 예) 2026-11-03T14:05:12+09:00
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "weekday": _WEEKDAYS[now.weekday()],  # weekday(): 월요일=0 ~ 일요일=6
        }
    )


# ============================================================
# 2. 계산기 (calculator)
# ============================================================

#  * 계산기를 eval() 로 만들지 않는 이유
#  - eval("식")은 식뿐 아니라 "모든 파이썬 코드"를 실행할 수 있음
#    => 모델이 만든 값(또는 사용자가 모델을 속여서 만든 값)으로
#       서버 파일을 지우는 등 위험한 일이 가능
#  - 대신 ast로 식을 구조(트리)로 분석하고, 허용한 숫자·연산·함수만 직접 계산함

# 식의 최대 길이 (너무 긴 식으로 서버를 느리게 만드는 것을 막음)
MAX_EXPRESSION_LENGTH = 200
# 정수 결과의 최대 크기 (비트 수, 약 3만 자리) - 9**9**9 처럼 엄청나게 큰 수 계산을 막음
MAX_INTEGER_BITS = 100_000

# 허용하는 연산 (식의 기호 => 실제 계산 함수)
_BINARY_OPERATORS: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,  # +
    ast.Sub: operator.sub,  # -
    ast.Mult: operator.mul,  # *
    ast.Div: operator.truediv,  # /
    ast.FloorDiv: operator.floordiv,  # // (몫)
    ast.Mod: operator.mod,  # % (나머지)
    ast.Pow: operator.pow,  # ** (거듭제곱)
}
_UNARY_OPERATORS: dict[type[ast.unaryop], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,  # +3
    ast.USub: operator.neg,  # -3
}
# 허용하는 함수 (예: sqrt(16))
_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "log": math.log,  # log(x): 자연로그 / log(x, 밑)
    "log10": math.log10,
    "exp": math.exp,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
}
# 허용하는 상수
_CONSTANTS: dict[str, float] = {"pi": math.pi, "e": math.e}


# 계산 결과 확인 (복소수 금지, 정수가 너무 크면 중단)
def _check_number(value: Any) -> int | float:
    # bool(True/False)도 int의 한 종류라서 따로 막음
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ToolError("계산 결과가 실수 범위를 벗어났습니다. (예: 음수의 제곱근)")
    if isinstance(value, int) and value.bit_length() > MAX_INTEGER_BITS:
        raise ToolError("계산 결과가 너무 큽니다.")
    return value


#  * 식의 구조(트리)를 따라가며 계산 (자기 자신을 다시 호출하는 "재귀" 방식)
#  - 예) "2 + 3 * 4" => BinOp(2, +, BinOp(3, *, 4)) => 3*4=12 먼저 계산 => 2+12=14
def _evaluate(node: ast.AST) -> int | float:
    # 1. 숫자 (예: 3, 2.5)
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    # 2. 상수 (예: pi)
    if isinstance(node, ast.Name) and node.id in _CONSTANTS:
        return _CONSTANTS[node.id]
    # 3. 부호 (예: -3)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        return _check_number(_UNARY_OPERATORS[type(node.op)](_evaluate(node.operand)))
    # 4. 사칙연산 등 (예: 2 + 3)
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        left = _evaluate(node.left)
        right = _evaluate(node.right)
        # 거듭제곱은 계산 "전에" 결과 크기를 미리 짐작해서 너무 크면 중단
        #  - 정수 a**b 의 비트 수 ≈ a의 비트 수 × b
        if isinstance(node.op, ast.Pow) and isinstance(left, int) and isinstance(right, int):
            if right > 0 and left.bit_length() * right > MAX_INTEGER_BITS:
                raise ToolError("계산 결과가 너무 큽니다.")
        return _check_number(_BINARY_OPERATORS[type(node.op)](left, right))
    # 5. 함수 (예: sqrt(16)) - 이름만 쓰는 단순한 호출만 허용 (sqrt(x=16) 같은 형식은 불가)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _FUNCTIONS
        and not node.keywords
    ):
        args = [_evaluate(arg) for arg in node.args]
        return _check_number(_FUNCTIONS[node.func.id](*args))
    # 6. 그 밖의 모든 것 (변수, 문자열, 속성 접근 등) => 거부
    raise ToolError(
        "지원하지 않는 식입니다. 숫자, + - * / // % **, 괄호, "
        f"함수({', '.join(_FUNCTIONS)}), 상수(pi, e)만 사용할 수 있습니다."
    )


# 결과 숫자 => 보기 좋은 문자열 (실수는 유효숫자 15자리, 예: 0.1+0.2 => 0.3)
def _format_number(value: int | float) -> str:
    if isinstance(value, float):
        return format(value, ".15g")
    return str(value)


async def calculator(arguments: dict[str, Any]) -> str:
    # 1. 식 확인
    expression = arguments.get("expression")
    if not isinstance(expression, str) or not expression.strip():
        raise ToolError("expression(계산식)을 문자열로 보내야 합니다. (예: (3 + 5) * 2)")
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ToolError(f"계산식은 {MAX_EXPRESSION_LENGTH}자 이하여야 합니다.")

    # 2. 식을 구조(트리)로 분석 (mode="eval": 하나의 "식"만 허용, 여러 줄 코드는 불가)
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as err:
        raise ToolError(f"계산식 형식이 올바르지 않습니다: {expression}") from err

    # 3. 계산 (0으로 나누기, 수학 함수 범위 오류, 실수 범위 초과 등은 알기 쉬운 메시지로)
    try:
        result = _evaluate(tree.body)
    except ZeroDivisionError as err:
        raise ToolError("0으로 나눌 수 없습니다.") from err
    except (ValueError, TypeError) as err:
        raise ToolError(f"계산할 수 없는 값입니다. ({err})") from err
    except OverflowError as err:
        raise ToolError("계산 결과가 너무 큽니다.") from err

    return _to_json({"expression": expression, "result": _format_number(result)})
