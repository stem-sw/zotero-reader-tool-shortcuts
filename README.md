# Zotero Reader Tool Shortcuts

서지 관리 프로그램 Zotero에 내장된 PDF 리더에서 주석 도구 버튼을 키보드 단축키로 활성화하는 Zotero 9–10 플러그인입니다.

## 지원 기능

- 노트 추가 도구 활성화
- 텍스트 추가 도구 활성화
  - PDF Reader 상단의 `T` 버튼 옆과 텍스트 주석 사이드바에서 글자 크기·줄 간격 조절
  - 글자 크기는 원본의 지원 단계(`3, 4, 5, 6, 8, …, 192`) 유지
  - 텍스트 주석 메뉴의 글자 크기도 같은 단계를 사용하며, **줄 간격 변경…** 메뉴 제공
  - 툴바의 줄 간격 입력칸에서 `0.5–3.0`배를 `0.1` 단위로 지정(기본 `1.8`배). 선택한 텍스트 상자와 새 텍스트의 기본값에 적용
  - 설정에서 새 텍스트 상자의 기본 줄 간격 변경
  - 텍스트 도구가 활성화된 상태에서 키보드 상단 숫자 `9`로 검은색 선택
  - 설정에서 기본 글자색을 색상 선택기로 변경
  - 기본 글자 크기를 플러그인 지원 단계(3–192) 중에서 선택
  - 붙여넣기·입력 시 한 줄 최대 폭을 설정(기본 `900`, Zotero 기본값은 `300`)
  - 페이지 오른쪽 가장자리에서도 텍스트 상자가 한 글자 폭으로 찌그러지지 않도록, 필요하면 상자를 왼쪽으로 이동해 가로 폭을 확보
  - 초기 기본값: 파란색 (`#2ea8e5`), 크기 `6`, 줄 간격 `1.8`배, 최대 폭 `900`
- 영역 선택 도구 활성화
- Zotero 설정에서 단축키 변경·해제·기본값 복원
- 검색창, 페이지 번호 입력창, 주석/노트 편집기에서는 단축키 자동 무시

단축키는 주석을 즉시 생성하지 않습니다. Zotero 툴바 버튼을 누른 것과 동일하게 도구 모드만 활성화합니다. 이후 PDF의 위치를 클릭하거나 영역을 드래그하면 주석이 생성됩니다.

줄 간격은 상자별로 저장하고, 수동·자동 줄바꿈에 맞춰 상자 높이도 다시 계산합니다. PDF 내보내기에서도 글자 크기·줄 간격·줄바꿈을 유지합니다. 툴바는 선택한 텍스트와 새 텍스트 기본값에, 주석 사이드바와 메뉴는 해당 주석에 적용됩니다.

내보내기는 Zotero에 설치된 PDF worker를 바탕으로 별도 worker에서 처리합니다. 원본 설치 파일은 수정하지 않으며, 플러그인 해제 시 연결을 복원합니다. 한글 글꼴 누락을 방지하기 위해 [Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr)의 Regular 정적 서브셋을 포함합니다. 글꼴 라이선스는 `addon/fonts/OFL.txt`에 있습니다.

## 기본 단축키

| 기능 | 기본값 |
|---|---|
| 노트 추가 | `Alt+3` |
| 텍스트 추가 | `Alt+4` |
| 영역 선택 | `Alt+5` |

## 설치

1. [GitHub Releases](https://github.com/stem-sw/zotero-reader-tool-shortcuts/releases/latest)에서 최신 `.xpi`를 다운로드합니다.
2. Zotero에서 **도구 → 플러그인**을 엽니다.
3. 우측 상단 톱니바퀴 메뉴에서 **파일에서 플러그인 설치**를 선택합니다.
4. `.xpi` 파일을 선택합니다.
5. 설치·업데이트 후에는 **Zotero를 완전히 종료한 뒤 다시 실행**합니다. PDF 탭이나 창만 닫는 대신 앱을 종료해 이전 버전의 Reader 연결을 초기화하세요.

플러그인 관리 화면에서 활성화/비활성화 또는 제거할 수 있습니다.

1.0.26으로 처음 업데이트하면 새 텍스트의 기본값을 크기 `6`, 줄 간격 `1.8`배로 적용합니다. 이후 사용자가 변경한 값은 재실행해도 유지합니다.

**1.0.24에서 업데이트한 경우:** Zotero를 완전히 종료한 뒤 다시 실행하세요. PDF 탭만 닫거나 실행 중에 플러그인만 교체하면 1.0.24의 화면 갱신 함수가 메모리에 남아, 메모·텍스트·하이라이트가 만들어져도 화면에 표시되지 않을 수 있습니다. 1.0.25부터는 이 함수를 교체하지 않습니다.

## 단축키 변경

1. Zotero에서 **편집 → 설정**을 엽니다.
2. **Reader Tool Shortcuts** 패널을 선택합니다.
3. 원하는 기능의 입력칸을 클릭합니다.
4. 새 키 조합을 누릅니다. 변경 사항은 즉시 적용됩니다.

같은 단축키를 두 기능에 중복 지정할 수 없습니다.

## 개발 및 빌드

요구 환경: Node.js, Python 3

```bash
npm test
npm run build
```

빌드 결과 XPI는 `dist/`에 생성되며, 저장소 루트의 `update.json`도 해당 XPI의 SHA-512 해시와 함께 갱신됩니다.

## 배포 및 버전 관리

- 소스 저장소: <https://github.com/stem-sw/zotero-reader-tool-shortcuts>
- `main` 브랜치의 `update.json`을 통해 Zotero가 새 버전을 확인합니다.
- GitHub Release의 태그와 manifest/package 버전은 `vX.Y.Z` / `X.Y.Z` 형식으로 일치시킵니다.
- `dist/`는 Git에서 제외하고 빌드된 XPI는 GitHub Release 자산으로 배포합니다.

## 호환성

- 라이브 확인 설치본:
  - Zotero `9.0.6`, BuildID `20260707151128`
  - Zotero `10.0.6`, BuildID `20261007153950`
  - Zotero `10.0.8`, BuildID `20261106171756`
- manifest 지원 범위: Zotero `9.0`–`10.0.*`

Zotero Reader의 공개 lifecycle hook을 사용하지만, 실제 키 입력 연결과 도구 활성화에는 Zotero 9.0.6 및 10.0.6에서 확인한 private Reader 필드와 내부 toolbar selector를 사용합니다.

- `Zotero.Reader._readers`
- `reader._waitForReader()` / `reader._initPromise`
- `reader._iframeWindow`
- `reader._internalReader._primaryView._iframeWindow`
- `.toolbar-button.note`
- `.toolbar-button.text`
- `.toolbar-button.area`

Zotero 메이저 업데이트에서 Reader 내부 구조나 DOM이 바뀌면 private 필드와 selector를 재검증해야 합니다.
