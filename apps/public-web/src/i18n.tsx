import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'ru';

const LANGUAGE_KEY = 'opengaussian_language';

const dictionaries: Record<Language, Record<string, string>> = {
  en: {
    'language.switch': 'Switch language',
    'language.en': 'EN',
    'language.ru': 'RU',
    'theme.switch': 'Switch to {theme} theme',
    'theme.dark': 'dark',
    'theme.light': 'light',
    'nav.primary': 'Primary navigation',
    'nav.admin': 'Admin',
    'nav.login': 'Log in',
    'catalog.sort.date': 'Date',
    'catalog.sort.count': 'Splat count',
    'catalog.kind.splat': 'Splat',
    'catalog.kind.sceneGroup': 'Scene group',
    'catalog.kind.organization': 'Organization',
    'catalog.points': 'points',
    'catalog.published': 'published',
    'catalog.publishedSplats': 'published splats',
    'catalog.open': 'Open',
    'catalog.openScene': 'Open scene',
    'catalog.openOrganization': 'Open organization',
    'catalog.loading': 'Catalog loading',
    'catalog.noPreview': 'No matching preview',
    'catalog.independentTitle': 'Independent splats',
    'catalog.independentDescription': 'Published scenes without an organization.',
    'catalog.noOrgMatches': 'No matching splats inside this organization for the current filters.',
    'catalog.heroKicker': 'Live Gaussian catalogue',
    'catalog.heroCopy': 'Search splats and organizations from one quiet surface, then open a scene without losing the visual thread.',
    'catalog.previewLabel': 'Catalog preview',
    'catalog.searchArea': 'Search area',
    'catalog.refreshing': 'Refreshing...',
    'catalog.result': '{count} result',
    'catalog.results': '{count} results',
    'catalog.search': 'Search',
    'catalog.searchPlaceholder': 'Search scenes or organizations',
    'catalog.searchAria': 'Search splats and organizations',
    'catalog.sortFilters': 'Sort & filters',
    'catalog.sortFilterAria': 'Sort and filter results',
    'catalog.sortBy': 'Sort by',
    'catalog.direction': 'Direction',
    'catalog.directionAria': 'Sort direction',
    'catalog.desc': 'Desc',
    'catalog.asc': 'Asc',
    'catalog.show': 'Show',
    'catalog.resultTypeAria': 'Result type filters',
    'catalog.splats': 'Splats',
    'catalog.orgs': 'Orgs',
    'catalog.none': 'None',
    'catalog.emptyTitle': 'No matching public results.',
    'catalog.emptyHint': 'Try enabling both result types or clearing the search phrase.',
    'org.loading': 'Loading organization...',
    'org.back': 'Back to catalog',
    'org.website': 'Website',
    'org.publishedSplats': 'Published splats',
    'org.scenesFrom': 'Public scenes from {name}.',
    'org.noPreview': 'No preview',
    'org.splats': 'splats',
    'org.empty': 'This organization has no public splats yet.',
    'auth.account': 'Account',
    'auth.signedInAs': 'You are signed in as {role}.',
    'auth.viewer': 'viewer',
    'auth.browseCatalog': 'Browse catalog',
    'auth.openAdmin': 'Open admin',
    'auth.signOut': 'Sign out',
    'auth.selfSignUp': 'Self sign up',
    'auth.logIn': 'Log in',
    'auth.createAccount': 'Create account',
    'auth.signIn': 'Sign in',
    'auth.name': 'Name',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.wait': 'Please wait...',
    'auth.haveAccount': 'Already have an account?',
    'auth.newHere': 'New here?',
    'auth.failed': 'Authentication failed',
    'viewer.loading': 'Loading scene...',
    'viewer.loadingProgress': 'Loading {phase} {progress}%',
    'viewer.back': 'Back to catalog',
    'viewer.quality': 'Quality',
    'viewer.asset': 'Asset',
    'viewer.camera': 'Camera',
    'viewer.orbit': 'Orbit',
    'viewer.fly': 'Fly',
    'viewer.auto': 'Auto',
    'viewer.low': 'Low',
    'viewer.medium': 'Medium',
    'viewer.high': 'High',
    'viewer.base': 'Base',
    'viewer.mobile': 'Mobile',
    'viewer.vr': 'VR',
    'viewer.enterVr': 'Enter VR',
    'viewer.startingVr': 'Starting VR...',
    'viewer.vrUnavailable': 'VR unavailable',
    'viewer.takePreview': 'Take preview',
    'viewer.capturing': 'Capturing...',
    'viewer.annotations': 'Annotations',
    'viewer.close': 'Close',
    'viewer.webgpu': 'WebGPU',
    'viewer.webgl2': 'WebGL2',
    'viewer.questPerf': 'Quest perf',
    'viewer.questPerfTitle': 'Quest performance',
    'viewer.closePanel': 'Close',
    'viewer.startCapture': 'Start capture',
    'viewer.stopCapture': 'Stop capture',
    'viewer.runMatrix': 'Run matrix',
    'viewer.downloadJson': 'JSON',
    'viewer.downloadCsv': 'CSV',
    'viewer.copy': 'Copy',
    'viewer.copied': 'Copied',
    'viewer.debug': 'Debug',
    'viewer.hideDebug': 'Press ` to hide',
    'viewer.yes': 'yes',
    'viewer.no': 'no',
    'viewer.off': 'off',
  },
  ru: {
    'language.switch': 'Сменить язык',
    'language.en': 'EN',
    'language.ru': 'RU',
    'theme.switch': 'Переключить на {theme} тему',
    'theme.dark': 'темную',
    'theme.light': 'светлую',
    'nav.primary': 'Основная навигация',
    'nav.admin': 'Админ',
    'nav.login': 'Войти',
    'catalog.sort.date': 'Дата',
    'catalog.sort.count': 'Число сплатов',
    'catalog.kind.splat': 'Сплат',
    'catalog.kind.sceneGroup': 'Группа сцен',
    'catalog.kind.organization': 'Организация',
    'catalog.points': 'точек',
    'catalog.published': 'опубликовано',
    'catalog.publishedSplats': 'опубликованных сплатов',
    'catalog.open': 'Открыть',
    'catalog.openScene': 'Открыть сцену',
    'catalog.openOrganization': 'Открыть организацию',
    'catalog.loading': 'Каталог загружается',
    'catalog.noPreview': 'Нет подходящего превью',
    'catalog.independentTitle': 'Независимые сплаты',
    'catalog.independentDescription': 'Опубликованные сцены без организации.',
    'catalog.noOrgMatches': 'В этой организации нет сплатов для текущих фильтров.',
    'catalog.heroKicker': 'Живой Gaussian-каталог',
    'catalog.heroCopy': 'Ищите сплаты и организации в одном спокойном интерфейсе, затем открывайте сцену без потери контекста.',
    'catalog.previewLabel': 'Превью каталога',
    'catalog.searchArea': 'Область поиска',
    'catalog.refreshing': 'Обновляем...',
    'catalog.result': '{count} результат',
    'catalog.results': '{count} результатов',
    'catalog.search': 'Поиск',
    'catalog.searchPlaceholder': 'Искать сцены или организации',
    'catalog.searchAria': 'Поиск сплатов и организаций',
    'catalog.sortFilters': 'Сортировка и фильтры',
    'catalog.sortFilterAria': 'Сортировка и фильтрация результатов',
    'catalog.sortBy': 'Сортировать по',
    'catalog.direction': 'Направление',
    'catalog.directionAria': 'Направление сортировки',
    'catalog.desc': 'Убыв.',
    'catalog.asc': 'Возр.',
    'catalog.show': 'Показывать',
    'catalog.resultTypeAria': 'Фильтры типов результатов',
    'catalog.splats': 'Сплаты',
    'catalog.orgs': 'Орг.',
    'catalog.none': 'Нет',
    'catalog.emptyTitle': 'Публичных результатов не найдено.',
    'catalog.emptyHint': 'Включите оба типа результатов или очистите поисковую фразу.',
    'org.loading': 'Организация загружается...',
    'org.back': 'Назад к каталогу',
    'org.website': 'Сайт',
    'org.publishedSplats': 'Опубликованные сплаты',
    'org.scenesFrom': 'Публичные сцены от {name}.',
    'org.noPreview': 'Нет превью',
    'org.splats': 'сплатов',
    'org.empty': 'У этой организации пока нет публичных сплатов.',
    'auth.account': 'Аккаунт',
    'auth.signedInAs': 'Вы вошли как {role}.',
    'auth.viewer': 'зритель',
    'auth.browseCatalog': 'Открыть каталог',
    'auth.openAdmin': 'Открыть админку',
    'auth.signOut': 'Выйти',
    'auth.selfSignUp': 'Регистрация',
    'auth.logIn': 'Вход',
    'auth.createAccount': 'Создать аккаунт',
    'auth.signIn': 'Войти',
    'auth.name': 'Имя',
    'auth.email': 'Email',
    'auth.password': 'Пароль',
    'auth.wait': 'Подождите...',
    'auth.haveAccount': 'Уже есть аккаунт?',
    'auth.newHere': 'Впервые здесь?',
    'auth.failed': 'Ошибка авторизации',
    'viewer.loading': 'Сцена загружается...',
    'viewer.loadingProgress': 'Загрузка {phase} {progress}%',
    'viewer.back': 'Назад к каталогу',
    'viewer.quality': 'Качество',
    'viewer.asset': 'Ассет',
    'viewer.camera': 'Камера',
    'viewer.orbit': 'Орбита',
    'viewer.fly': 'Полет',
    'viewer.auto': 'Авто',
    'viewer.low': 'Низкое',
    'viewer.medium': 'Среднее',
    'viewer.high': 'Высокое',
    'viewer.base': 'База',
    'viewer.mobile': 'Мобильный',
    'viewer.vr': 'VR',
    'viewer.enterVr': 'Войти в VR',
    'viewer.startingVr': 'Запускаем VR...',
    'viewer.vrUnavailable': 'VR недоступен',
    'viewer.takePreview': 'Снять превью',
    'viewer.capturing': 'Снимаем...',
    'viewer.annotations': 'Аннотации',
    'viewer.close': 'Закрыть',
    'viewer.webgpu': 'WebGPU',
    'viewer.webgl2': 'WebGL2',
    'viewer.questPerf': 'Quest perf',
    'viewer.questPerfTitle': 'Производительность Quest',
    'viewer.closePanel': 'Закрыть',
    'viewer.startCapture': 'Начать запись',
    'viewer.stopCapture': 'Остановить',
    'viewer.runMatrix': 'Матрица',
    'viewer.downloadJson': 'JSON',
    'viewer.downloadCsv': 'CSV',
    'viewer.copy': 'Копировать',
    'viewer.copied': 'Скопировано',
    'viewer.debug': 'Отладка',
    'viewer.hideDebug': 'Нажмите `, чтобы скрыть',
    'viewer.yes': 'да',
    'viewer.no': 'нет',
    'viewer.off': 'выкл',
  },
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(LANGUAGE_KEY) === 'ru' ? 'ru' : 'en';
}

function applyLanguage(language: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY) setLanguageState(event.newValue === 'ru' ? 'ru' : 'en');
    };
    const onLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<Language>).detail;
      if (next === 'en' || next === 'ru') setLanguageState(next);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('opengaussian-language-change', onLanguageChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('opengaussian-language-change', onLanguageChange);
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    window.localStorage.setItem(LANGUAGE_KEY, next);
    applyLanguage(next);
    setLanguageState(next);
    window.dispatchEvent(new CustomEvent<Language>('opengaussian-language-change', { detail: next }));
  }, []);

  const t = useCallback((key: string, values?: Record<string, string | number>) => {
    const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
    if (!values) return template;
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  const nextLanguage: Language = language === 'en' ? 'ru' : 'en';

  return (
    <button
      className="language-switch"
      type="button"
      aria-label={t('language.switch')}
      title={t('language.switch')}
      onClick={() => setLanguage(nextLanguage)}
    >
      <span className={language === 'en' ? 'active' : ''}>{t('language.en')}</span>
      <span className={language === 'ru' ? 'active' : ''}>{t('language.ru')}</span>
    </button>
  );
}
