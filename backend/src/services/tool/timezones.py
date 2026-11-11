#  * 나라/도시 이름 => 시간대 찾기 (현재 시각 도구 get_current_time 에서 사용)
#  - 파이썬의 시간대 기능(zoneinfo)은 "Europe/Moscow" 같은 IANA 시간대 이름만 알아들음
#    => 모델이 "러시아", "캐나다", "Asia/Moscow"(잘못된 이름), "UTC+3" 처럼 보내도
#       찾을 수 있게 도와줌
#  - 시간대 정보는 tzdata 패키지(서버에 함께 설치됨)에서 읽음
#    => 인터넷 연결 없이 동작 (폐쇄망 대비)
#
# 📌 찾는 순서 (resolve_location)
#  1) 나라/도시 이름표 (한국어, 영어) - 예) 러시아, Canada, 뉴욕, 모스크바
#  2) 정확한 IANA 시간대 이름       - 예) Europe/Moscow, UTC
#  3) UTC 기준 시차                 - 예) UTC+3, GMT-5, +09:00, UTC+5:30
#  4) IANA 시간대의 도시 부분       - 예) Asia/Moscow => Moscow => Europe/Moscow
#                                         "Paris" => Europe/Paris
#  5) 문장 안에 들어 있는 나라/도시 이름 - 예) "러시아의 현재 시각" => 러시아
#
# 📌 시간대가 여러 개인 나라 (미국, 캐나다, 러시아, 브라질, 호주 등)
#  - 수도(기준 도시) 시각을 알려주고, 다른 시간대의 대표 도시를 안내 문구(note)로 함께 돌려줌
#    => 모델이 필요하면 도시 이름으로 다시 조회할 수 있음

import re
from dataclasses import dataclass
from datetime import timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

# ============================================================
# 1. 나라 / 도시 이름표
# ============================================================

#  * 나라 목록: (나라 이름, 시간대, 수도(기준 도시), 다른 이름들, 다른 시간대의 대표 도시)
#  - 시간대: 수도의 IANA 시간대
#    (IANA 이름은 수도가 아닌 같은 시간대의 대표 도시일 수 있음 - 예: 베이징 => Asia/Shanghai)
#  - 다른 이름들: 영어 이름, 줄임말, 다른 한국어 표기 (대소문자, 띄어쓰기는 구분하지 않음)
#  - 다른 시간대의 대표 도시: 시간대가 여러 개인 나라만 (아래 CITIES 에 있는 이름)
COUNTRIES: list[tuple[str, str, str, tuple[str, ...], tuple[str, ...]]] = [
    # ----- 아시아 -----
    (
        "한국",
        "Asia/Seoul",
        "서울",
        ("대한민국", "남한", "korea", "south korea", "republic of korea", "kr", "kor"),
        (),
    ),
    ("북한", "Asia/Pyongyang", "평양", ("north korea", "dprk", "kp"), ()),
    ("일본", "Asia/Tokyo", "도쿄", ("japan", "jp", "jpn"), ()),
    ("중국", "Asia/Shanghai", "베이징", ("china", "cn", "chn", "중화인민공화국"), ()),
    ("대만", "Asia/Taipei", "타이베이", ("타이완", "taiwan", "tw"), ()),
    ("홍콩", "Asia/Hong_Kong", "홍콩", ("hong kong", "hk"), ()),
    ("마카오", "Asia/Macau", "마카오", ("macau", "macao"), ()),
    ("몽골", "Asia/Ulaanbaatar", "울란바토르", ("mongolia",), ("호브드",)),
    ("베트남", "Asia/Ho_Chi_Minh", "하노이", ("vietnam", "viet nam", "vn"), ()),
    ("태국", "Asia/Bangkok", "방콕", ("thailand", "th"), ()),
    ("필리핀", "Asia/Manila", "마닐라", ("philippines", "ph"), ()),
    ("인도네시아", "Asia/Jakarta", "자카르타", ("indonesia",), ("발리", "자야푸라")),
    ("말레이시아", "Asia/Kuala_Lumpur", "쿠알라룸푸르", ("malaysia",), ()),
    ("싱가포르", "Asia/Singapore", "싱가포르", ("singapore", "sg"), ()),
    ("캄보디아", "Asia/Phnom_Penh", "프놈펜", ("cambodia",), ()),
    ("라오스", "Asia/Vientiane", "비엔티안", ("laos",), ()),
    ("미얀마", "Asia/Yangon", "네피도", ("myanmar", "버마", "burma"), ()),
    ("인도", "Asia/Kolkata", "뉴델리", ("india",), ()),
    ("파키스탄", "Asia/Karachi", "이슬라마바드", ("pakistan",), ()),
    ("방글라데시", "Asia/Dhaka", "다카", ("bangladesh",), ()),
    ("네팔", "Asia/Kathmandu", "카트만두", ("nepal",), ()),
    ("스리랑카", "Asia/Colombo", "콜롬보", ("sri lanka",), ()),
    ("카자흐스탄", "Asia/Almaty", "아스타나", ("kazakhstan",), ()),
    ("우즈베키스탄", "Asia/Tashkent", "타슈켄트", ("uzbekistan",), ()),
    ("아프가니스탄", "Asia/Kabul", "카불", ("afghanistan",), ()),
    ("이란", "Asia/Tehran", "테헤란", ("iran",), ()),
    ("이라크", "Asia/Baghdad", "바그다드", ("iraq",), ()),
    ("사우디아라비아", "Asia/Riyadh", "리야드", ("사우디", "saudi arabia", "saudi"), ()),
    ("아랍에미리트", "Asia/Dubai", "아부다비", ("uae", "united arab emirates", "에미리트"), ()),
    ("카타르", "Asia/Qatar", "도하", ("qatar",), ()),
    ("쿠웨이트", "Asia/Kuwait", "쿠웨이트시티", ("kuwait",), ()),
    ("이스라엘", "Asia/Jerusalem", "예루살렘", ("israel",), ()),
    ("요르단", "Asia/Amman", "암만", ("jordan",), ()),
    ("레바논", "Asia/Beirut", "베이루트", ("lebanon",), ()),
    ("시리아", "Asia/Damascus", "다마스쿠스", ("syria",), ()),
    ("튀르키예", "Europe/Istanbul", "앙카라", ("터키", "turkey", "türkiye", "turkiye"), ()),
    ("조지아", "Asia/Tbilisi", "트빌리시", ("georgia", "그루지야"), ()),
    ("아르메니아", "Asia/Yerevan", "예레반", ("armenia",), ()),
    ("아제르바이잔", "Asia/Baku", "바쿠", ("azerbaijan",), ()),
    # ----- 유럽 -----
    (
        "영국",
        "Europe/London",
        "런던",
        ("united kingdom", "uk", "britain", "great britain", "england", "잉글랜드"),
        (),
    ),
    ("아일랜드", "Europe/Dublin", "더블린", ("ireland",), ()),
    ("프랑스", "Europe/Paris", "파리", ("france", "fr"), ()),
    ("독일", "Europe/Berlin", "베를린", ("germany", "de", "deutschland"), ()),
    ("이탈리아", "Europe/Rome", "로마", ("italy", "it"), ()),
    ("스페인", "Europe/Madrid", "마드리드", ("spain", "es", "에스파냐"), ("카나리아 제도",)),
    ("포르투갈", "Europe/Lisbon", "리스본", ("portugal",), ("아조레스 제도",)),
    ("네덜란드", "Europe/Amsterdam", "암스테르담", ("netherlands", "holland", "nl"), ()),
    ("벨기에", "Europe/Brussels", "브뤼셀", ("belgium",), ()),
    ("룩셈부르크", "Europe/Luxembourg", "룩셈부르크", ("luxembourg",), ()),
    ("스위스", "Europe/Zurich", "베른", ("switzerland", "ch"), ()),
    ("오스트리아", "Europe/Vienna", "빈", ("austria",), ()),
    ("덴마크", "Europe/Copenhagen", "코펜하겐", ("denmark",), ()),
    ("노르웨이", "Europe/Oslo", "오슬로", ("norway",), ()),
    ("스웨덴", "Europe/Stockholm", "스톡홀름", ("sweden",), ()),
    ("핀란드", "Europe/Helsinki", "헬싱키", ("finland",), ()),
    ("아이슬란드", "Atlantic/Reykjavik", "레이캬비크", ("iceland",), ()),
    ("폴란드", "Europe/Warsaw", "바르샤바", ("poland",), ()),
    ("체코", "Europe/Prague", "프라하", ("czech", "czechia", "czech republic"), ()),
    ("슬로바키아", "Europe/Bratislava", "브라티슬라바", ("slovakia",), ()),
    ("헝가리", "Europe/Budapest", "부다페스트", ("hungary",), ()),
    ("루마니아", "Europe/Bucharest", "부쿠레슈티", ("romania",), ()),
    ("불가리아", "Europe/Sofia", "소피아", ("bulgaria",), ()),
    ("그리스", "Europe/Athens", "아테네", ("greece",), ()),
    ("크로아티아", "Europe/Zagreb", "자그레브", ("croatia",), ()),
    ("세르비아", "Europe/Belgrade", "베오그라드", ("serbia",), ()),
    ("슬로베니아", "Europe/Ljubljana", "류블랴나", ("slovenia",), ()),
    ("우크라이나", "Europe/Kyiv", "키이우", ("ukraine",), ()),
    ("벨라루스", "Europe/Minsk", "민스크", ("belarus",), ()),
    (
        "러시아",
        "Europe/Moscow",
        "모스크바",
        ("russia", "ru", "러시아 연방"),
        ("예카테린부르크", "노보시비르스크", "블라디보스토크", "캄차카"),
    ),
    ("에스토니아", "Europe/Tallinn", "탈린", ("estonia",), ()),
    ("라트비아", "Europe/Riga", "리가", ("latvia",), ()),
    ("리투아니아", "Europe/Vilnius", "빌뉴스", ("lithuania",), ()),
    ("몰타", "Europe/Malta", "발레타", ("malta",), ()),
    ("키프로스", "Asia/Nicosia", "니코시아", ("cyprus",), ()),
    # ----- 아메리카 -----
    (
        "미국",
        "America/New_York",
        "워싱턴",
        ("usa", "us", "united states", "united states of america", "america", "미합중국"),
        ("시카고", "덴버", "로스앤젤레스", "앵커리지", "호놀룰루"),
    ),
    (
        "캐나다",
        "America/Toronto",
        "오타와",
        ("canada", "ca"),
        ("밴쿠버", "캘거리", "위니펙", "핼리팩스", "세인트존스"),
    ),
    ("멕시코", "America/Mexico_City", "멕시코시티", ("mexico", "mx"), ("티후아나", "칸쿤")),
    (
        "브라질",
        "America/Sao_Paulo",
        "브라질리아",
        ("brazil", "br"),
        ("마나우스", "페르난두지노로냐"),
    ),
    ("아르헨티나", "America/Argentina/Buenos_Aires", "부에노스아이레스", ("argentina",), ()),
    ("칠레", "America/Santiago", "산티아고", ("chile",), ("이스터섬",)),
    ("페루", "America/Lima", "리마", ("peru",), ()),
    ("콜롬비아", "America/Bogota", "보고타", ("colombia",), ()),
    ("베네수엘라", "America/Caracas", "카라카스", ("venezuela",), ()),
    ("에콰도르", "America/Guayaquil", "키토", ("ecuador",), ("갈라파고스",)),
    ("볼리비아", "America/La_Paz", "라파스", ("bolivia",), ()),
    ("파라과이", "America/Asuncion", "아순시온", ("paraguay",), ()),
    ("우루과이", "America/Montevideo", "몬테비데오", ("uruguay",), ()),
    ("쿠바", "America/Havana", "아바나", ("cuba",), ()),
    ("자메이카", "America/Jamaica", "킹스턴", ("jamaica",), ()),
    ("파나마", "America/Panama", "파나마시티", ("panama",), ()),
    ("코스타리카", "America/Costa_Rica", "산호세", ("costa rica",), ()),
    ("과테말라", "America/Guatemala", "과테말라시티", ("guatemala",), ()),
    (
        "도미니카 공화국",
        "America/Santo_Domingo",
        "산토도밍고",
        ("도미니카", "dominican republic"),
        (),
    ),
    # ----- 오세아니아 -----
    (
        "호주",
        "Australia/Sydney",
        "캔버라",
        ("오스트레일리아", "australia", "au"),
        ("퍼스", "애들레이드", "브리즈번", "다윈"),
    ),
    ("뉴질랜드", "Pacific/Auckland", "웰링턴", ("new zealand", "nz"), ()),
    ("피지", "Pacific/Fiji", "수바", ("fiji",), ()),
    ("괌", "Pacific/Guam", "하갓냐", ("guam",), ()),
    # ----- 아프리카 -----
    ("이집트", "Africa/Cairo", "카이로", ("egypt",), ()),
    ("남아프리카공화국", "Africa/Johannesburg", "프리토리아", ("남아공", "south africa"), ()),
    ("나이지리아", "Africa/Lagos", "아부자", ("nigeria",), ()),
    ("케냐", "Africa/Nairobi", "나이로비", ("kenya",), ()),
    ("에티오피아", "Africa/Addis_Ababa", "아디스아바바", ("ethiopia",), ()),
    ("모로코", "Africa/Casablanca", "라바트", ("morocco",), ()),
    ("알제리", "Africa/Algiers", "알제", ("algeria",), ()),
    ("튀니지", "Africa/Tunis", "튀니스", ("tunisia",), ()),
    ("리비아", "Africa/Tripoli", "트리폴리", ("libya",), ()),
    ("수단", "Africa/Khartoum", "하르툼", ("sudan",), ()),
    ("가나", "Africa/Accra", "아크라", ("ghana",), ()),
    ("세네갈", "Africa/Dakar", "다카르", ("senegal",), ()),
    ("탄자니아", "Africa/Dar_es_Salaam", "도도마", ("tanzania",), ()),
    ("우간다", "Africa/Kampala", "캄팔라", ("uganda",), ()),
    ("르완다", "Africa/Kigali", "키갈리", ("rwanda",), ()),
    ("콩고민주공화국", "Africa/Kinshasa", "킨샤사", ("민주콩고", "dr congo", "drc"), ("루붐바시",)),
    ("앙골라", "Africa/Luanda", "루안다", ("angola",), ()),
    ("짐바브웨", "Africa/Harare", "하라레", ("zimbabwe",), ()),
]

#  * 도시 목록: (도시 이름, 시간대, 다른 이름들)
#  - 나라의 수도는 위 COUNTRIES 에서 자동으로 도시로 등록되므로 여기에는 수도가 아닌 도시만 둠
#  - 영어 도시 이름(Paris, Moscow 등)은 IANA 시간대 이름에서 자동으로 찾으므로 꼭 필요한 것만 적음
CITIES: list[tuple[str, str, tuple[str, ...]]] = [
    # 미국
    ("뉴욕", "America/New_York", ("new york", "nyc")),
    ("보스턴", "America/New_York", ("boston",)),
    ("마이애미", "America/New_York", ("miami",)),
    ("애틀랜타", "America/New_York", ("atlanta",)),
    ("시카고", "America/Chicago", ("chicago",)),
    ("휴스턴", "America/Chicago", ("houston",)),
    ("댈러스", "America/Chicago", ("dallas",)),
    ("덴버", "America/Denver", ("denver",)),
    ("피닉스", "America/Phoenix", ("phoenix",)),
    ("로스앤젤레스", "America/Los_Angeles", ("la", "엘에이", "los angeles")),
    ("샌프란시스코", "America/Los_Angeles", ("san francisco", "sf")),
    ("시애틀", "America/Los_Angeles", ("seattle",)),
    ("라스베이거스", "America/Los_Angeles", ("las vegas", "라스베가스")),
    ("앵커리지", "America/Anchorage", ("알래스카", "alaska", "anchorage")),
    ("호놀룰루", "Pacific/Honolulu", ("하와이", "hawaii", "honolulu")),
    # 캐나다
    ("토론토", "America/Toronto", ("toronto",)),
    ("몬트리올", "America/Toronto", ("montreal",)),
    ("밴쿠버", "America/Vancouver", ("vancouver",)),
    ("캘거리", "America/Edmonton", ("calgary",)),
    ("에드먼턴", "America/Edmonton", ("edmonton",)),
    ("위니펙", "America/Winnipeg", ("winnipeg",)),
    ("핼리팩스", "America/Halifax", ("halifax",)),
    ("세인트존스", "America/St_Johns", ("st johns", "st. john's", "뉴펀들랜드", "newfoundland")),
    # 중남미
    ("티후아나", "America/Tijuana", ("tijuana",)),
    ("칸쿤", "America/Cancun", ("cancun",)),
    ("상파울루", "America/Sao_Paulo", ("sao paulo", "são paulo")),
    ("리우데자네이루", "America/Sao_Paulo", ("리우", "rio de janeiro", "rio")),
    ("마나우스", "America/Manaus", ("manaus",)),
    ("페르난두지노로냐", "America/Noronha", ("noronha",)),
    ("이스터섬", "Pacific/Easter", ("easter island",)),
    ("갈라파고스", "Pacific/Galapagos", ("galapagos",)),
    # 러시아
    ("상트페테르부르크", "Europe/Moscow", ("saint petersburg", "st petersburg")),
    ("예카테린부르크", "Asia/Yekaterinburg", ("yekaterinburg",)),
    ("노보시비르스크", "Asia/Novosibirsk", ("novosibirsk",)),
    ("블라디보스토크", "Asia/Vladivostok", ("vladivostok",)),
    ("캄차카", "Asia/Kamchatka", ("kamchatka", "페트로파블롭스크캄차츠키")),
    # 호주, 뉴질랜드
    ("시드니", "Australia/Sydney", ("sydney",)),
    ("멜버른", "Australia/Melbourne", ("melbourne",)),
    ("브리즈번", "Australia/Brisbane", ("brisbane",)),
    ("퍼스", "Australia/Perth", ("perth",)),
    ("애들레이드", "Australia/Adelaide", ("adelaide",)),
    ("다윈", "Australia/Darwin", ("darwin",)),
    ("오클랜드", "Pacific/Auckland", ("auckland",)),
    # 아시아, 유럽, 기타
    ("부산", "Asia/Seoul", ("busan",)),
    ("오사카", "Asia/Tokyo", ("osaka",)),
    ("상하이", "Asia/Shanghai", ("shanghai",)),
    ("호찌민", "Asia/Ho_Chi_Minh", ("호치민", "ho chi minh", "saigon", "사이공")),
    ("발리", "Asia/Makassar", ("bali",)),
    ("자야푸라", "Asia/Jayapura", ("jayapura",)),
    ("호브드", "Asia/Hovd", ("hovd",)),
    ("뭄바이", "Asia/Kolkata", ("mumbai",)),
    ("두바이", "Asia/Dubai", ("dubai",)),
    ("이스탄불", "Europe/Istanbul", ("istanbul",)),
    ("바르셀로나", "Europe/Madrid", ("barcelona",)),
    ("카나리아 제도", "Atlantic/Canary", ("canary islands",)),
    ("아조레스 제도", "Atlantic/Azores", ("azores",)),
    ("밀라노", "Europe/Rome", ("milan",)),
    ("뮌헨", "Europe/Berlin", ("munich",)),
    ("프랑크푸르트", "Europe/Berlin", ("frankfurt",)),
    ("취리히", "Europe/Zurich", ("zurich",)),
    ("요하네스버그", "Africa/Johannesburg", ("johannesburg",)),
    ("라고스", "Africa/Lagos", ("lagos",)),
    ("루붐바시", "Africa/Lubumbashi", ("lubumbashi",)),
]


# ============================================================
# 2. 찾기
# ============================================================


#  * 찾은 결과
#  - tz: 실제 시각 계산에 쓰는 시간대 / timezone: 시간대 이름 (예: Europe/Moscow, UTC+03:00)
#  - location: 결과에 보여줄 장소 이름 (예: 러시아) / reference: 기준 도시 (나라를 찾은 경우의 수도)
#  - note: 시간대가 여러 개인 나라의 안내 문구 (없으면 None)
@dataclass(frozen=True)
class ResolvedLocation:
    tz: ZoneInfo | timezone
    timezone: str
    location: str
    reference: str | None = None
    note: str | None = None


#  * 비교용 이름 만들기: 대소문자 무시(casefold) + 띄어쓰기/점/밑줄/하이픈 제거
#  - 예) "New York", "new_york", "NEW-YORK" => "newyork"
def _key(text: str) -> str:
    return re.sub(r"[\s._'\-]", "", text.casefold())


#  * 이름표 만들기 {비교용 이름: 찾은 결과(시간대 제외 정보)}
#  - 처음 한 번만 만들고 재사용 (lru_cache)
#  - 값: (시간대 이름, 장소 이름, 기준 도시, 안내 문구)
@lru_cache(maxsize=1)
def _name_table() -> dict[str, tuple[str, str, str | None, str | None]]:
    table: dict[str, tuple[str, str, str | None, str | None]] = {}
    # 1. 도시 (수도 포함)
    for city, tz_name, aliases in CITIES:
        for alias in (city, *aliases):
            table.setdefault(_key(alias), (tz_name, city, None, None))
    for _, tz_name, capital, _, _ in COUNTRIES:
        table.setdefault(_key(capital), (tz_name, capital, None, None))
    # 2. 나라 (나라 이름이 도시 이름과 같으면 나라 쪽으로 덮어씀 - 예: 싱가포르, 홍콩)
    for country, tz_name, capital, aliases, other_cities in COUNTRIES:
        note = None
        if other_cities:
            note = (
                f"{country}는(은) 시간대가 여러 개입니다. 수도 {capital} 기준 시각이며, "
                f"다른 지역은 도시 이름으로 다시 조회하세요. (예: {', '.join(other_cities)})"
            )
        for alias in (country, *aliases):
            table[_key(alias)] = (tz_name, country, capital, note)
    return table


#  * IANA 시간대 이름표
#  - full: {소문자 전체 이름: 정확한 이름} (예: "europe/moscow" => "Europe/Moscow")
#  - city: {도시 부분의 비교용 이름: 정확한 이름} (예: "moscow" => "Europe/Moscow")
#  - available_timezones(): tzdata 에 들어 있는 모든 시간대 이름 (약 600개)
@lru_cache(maxsize=1)
def _iana_tables() -> tuple[dict[str, str], dict[str, str]]:
    names = sorted(available_timezones())
    full = {name.casefold(): name for name in names}
    city: dict[str, str] = {}
    for name in names:
        # Etc/GMT+3 같은 이름은 부호가 반대라 헷갈리므로 도시 찾기에서는 제외
        if "/" in name and not name.startswith(("Etc/", "SystemV/")):
            city.setdefault(_key(name.rsplit("/", 1)[1]), name)
    return full, city


#  * UTC 기준 시차 해석 => 시간대 (해석 못 하면 None)
#  - 예) "UTC+3", "GMT-05:00", "+09:00", "utc+5:30"
_OFFSET_PATTERN = re.compile(r"^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$")


def _parse_offset(text: str) -> ResolvedLocation | None:
    match = _OFFSET_PATTERN.match(text.strip().casefold())
    if not match:
        return None
    sign, hours, minutes = match.group(1), int(match.group(2)), int(match.group(3) or 0)
    # 실제로 쓰이는 시차 범위는 -12시간 ~ +14시간
    if hours > 14 or minutes >= 60:
        return None
    delta = timedelta(hours=hours, minutes=minutes) * (1 if sign == "+" else -1)
    label = f"UTC{sign}{hours:02d}:{minutes:02d}"
    return ResolvedLocation(tz=timezone(delta, label), timezone=label, location=label)


# 이름표의 값으로 결과 만들기
def _from_table(value: tuple[str, str, str | None, str | None]) -> ResolvedLocation:
    tz_name, location, reference, note = value
    return ResolvedLocation(
        tz=ZoneInfo(tz_name), timezone=tz_name, location=location, reference=reference, note=note
    )


#  * 장소(나라/도시/시간대 이름/시차) => 시간대 찾기 (찾지 못하면 None)
#  - 찾는 순서는 맨 위 설명 참고
def resolve_location(text: str) -> ResolvedLocation | None:
    text = text.strip()
    if not text:
        return None
    key = _key(text)
    names = _name_table()
    full, city = _iana_tables()

    # 1. 나라/도시 이름표
    if key in names:
        return _from_table(names[key])
    # 2. 정확한 IANA 시간대 이름 (대소문자는 무시)
    if text.casefold() in full:
        tz_name = full[text.casefold()]
        return ResolvedLocation(tz=ZoneInfo(tz_name), timezone=tz_name, location=tz_name)
    # 3. UTC 기준 시차
    offset = _parse_offset(text)
    if offset:
        return offset
    # 4. IANA 시간대의 도시 부분 (예: "Asia/Moscow" => "Moscow" => Europe/Moscow)
    last = _key(text.rsplit("/", 1)[-1])
    if last in names:
        return _from_table(names[last])
    if last in city:
        tz_name = city[last]
        return ResolvedLocation(tz=ZoneInfo(tz_name), timezone=tz_name, location=text)
    #  5. 문장 안에 들어 있는 나라/도시 이름 (예: "러시아의 현재 시각")
    #  - 가장 긴 이름부터 확인 (예: "인도네시아"를 "인도"로 잘못 찾지 않도록)
    #  - 영어 이름은 단어 단위로만 (예: "indiana" 안의 "india" 는 무시)
    #  - 3글자 이하 영어 줄임말(us, uk 등)과 한 글자 한국어 이름(빈)은 다른 글자와 헷갈리므로 제외
    lowered = text.casefold()
    for alias in sorted(_all_aliases(), key=len, reverse=True):
        if len(alias) < 2:
            continue
        if alias.isascii():
            if len(alias) <= 3 or not re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])", lowered):
                continue
        elif alias not in lowered:
            continue
        return _from_table(names[_key(alias)])
    return None


# 문장 안에서 찾을 때 쓰는 모든 이름 (소문자, 띄어쓰기 유지)
@lru_cache(maxsize=1)
def _all_aliases() -> tuple[str, ...]:
    aliases: list[str] = []
    for city_name, _, city_aliases in CITIES:
        aliases.extend((city_name, *city_aliases))
    for country, _, capital, country_aliases, _ in COUNTRIES:
        aliases.extend((country, capital, *country_aliases))
    return tuple(dict.fromkeys(alias.casefold() for alias in aliases))


# 시간대 이름이 서버의 시간대 정보(tzdata)에 있는지 확인 (테스트, 점검용)
def is_valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True
