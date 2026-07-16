# Zotero Reader Tool Shortcuts

Zotero PDF Reader에서 주석 도구 버튼을 키보드 단축키로 활성화하는 Zotero 9 플러그인입니다.

## 지원 기능

- 노트 추가 도구 활성화
- 텍스트 추가 도구 활성화
- 영역 선택 도구 활성화
- Zotero 설정에서 단축키 변경·해제·기본값 복원
- 검색창, 페이지 번호 입력창, 주석/노트 편집기에서는 단축키 자동 무시

단축키는 주석을 즉시 생성하지 않습니다. Zotero 툴바 버튼을 누른 것과 동일하게 도구 모드만 활성화합니다. 이후 PDF의 위치를 클릭하거나 영역을 드래그하면 주석이 생성됩니다.

## 기본 단축키

| 기능 | 기본값 |
|---|---|
| 노트 추가 | `Alt+N` |
| 텍스트 추가 | `Alt+T` |
| 영역 선택 | `Alt+A` |

## 설치

1. [GitHub Releases](https://github.com/stem-sw/zotero-reader-tool-shortcuts/releases/latest)에서 최신 `.xpi`를 다운로드합니다.
2. Zotero에서 **도구 → 플러그인**을 엽니다.
3. 우측 상단 톱니바퀴 메뉴에서 **파일에서 플러그인 설치**를 선택합니다.
4. `.xpi` 파일을 선택합니다.

플러그인 관리 화면에서 활성화/비활성화 또는 제거할 수 있습니다.

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

- 확인한 설치본: Zotero `9.0.6`, BuildID `20260707151128`
- manifest 지원 범위: Zotero `9.0`–`9.*`

Zotero Reader의 공개 lifecycle hook을 사용하지만, 실제 키 입력 연결과 도구 활성화에는 Zotero 9.0.6에서 확인한 private Reader 필드와 내부 toolbar selector를 사용합니다.

- `Zotero.Reader._readers`
- `reader._waitForReader()` / `reader._initPromise`
- `reader._iframeWindow`
- `reader._internalReader._primaryView._iframeWindow`
- `.toolbar-button.note`
- `.toolbar-button.text`
- `.toolbar-button.area`

Zotero 메이저 업데이트에서 Reader 내부 구조나 DOM이 바뀌면 private 필드와 selector를 재검증해야 합니다.
