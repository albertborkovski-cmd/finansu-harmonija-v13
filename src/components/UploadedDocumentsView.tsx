import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileText, Plus, Search, X } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { SystemBreadcrumb } from './SystemNavigation';
import ColumnSortButton, { useMultiColumnSort } from './ColumnSortButton';
import type { ColConfig } from './ColumnSettingsPanel';
import HorizontalTableScrollbar from './HorizontalTableScrollbar';
import OcrSearchField from './OcrSearchField';
import TablePagination from './TablePagination';
import { ResizeHandle, useColumnResize } from './useColumnResize';
import { supabase, type Company, type DbDocument } from '../lib/supabase';
import { getSearchSuggestions, matchesTextSearch } from '../utils/textSearch';

type UploadedStatus =
  | 'Processing'
  | 'Processed'
  | 'Organization not identified'
  | 'Rejected'
  | 'Exception'
  | 'Duplicate'
  | 'Not document';

type StatusGroup = 'All' | 'Processing' | 'Needs attention' | 'Processed';
type UploadedFilterKey = 'uploaded' | 'organization' | 'status' | 'sourceType' | 'sourceValue';

const PAGE_SIZE = 50;
const UNASSIGNED_TEST_DOCUMENT_ID = 'uploaded-document-unassigned-test';
const DUPLICATE_TEST_DOCUMENT_ID = 'uploaded-document-duplicate-test';

const UNASSIGNED_TEST_DOCUMENT: DbDocument = {
  id: UNASSIGNED_TEST_DOCUMENT_ID,
  receive_date: '28.08.2026',
  client_counterparty: 'Organization pending identification',
  document_type: 'VAT invoice',
  source: 'Email',
  total_amount: '0.00 €',
  due_end_date: '',
  file_case: 'UNASSIGNED-TEST-001.pdf',
  order_no: '',
  number: 'UNASSIGNED-TEST-001',
  type: 'Expense',
  document_date: '28.08.2026',
  document_purpose: 'Organization assignment test',
  invoice_contract_date: '',
  operation_date: '28.08.2026',
  expense_account: '',
  vat_classifier: '',
  currency: 'EUR',
  amount_without_vat: '0.00 €',
  vat: '0.00 €',
  vat_percent: '0%',
  department_code: '',
  object_project: '',
  valid_form: 'Organization identification required',
  accountable_responsible: '',
  cost_center: '',
  series: '',
  status: 'Processing',
  created_at: '2026-08-28T09:00:00.000Z',
  created_by: 'sender@example.com',
  image_url: null,
};

type UploadedColumnKey = 'document' | 'organization' | 'status' | 'uploaded';

const UPLOADED_DOCUMENT_COLUMNS = [
  { key: 'document', label: 'Document', width: 230, visible: true },
  { key: 'organization', label: 'Organization', width: 170, visible: true },
  { key: 'status', label: 'Status', width: 270, visible: true },
  { key: 'uploaded', label: 'Uploaded', width: 150, visible: true },
] satisfies Array<{ key: UploadedColumnKey; label: string; width: number; visible: boolean }>;

const UPLOADED_FILTERS: Array<{ key: UploadedFilterKey; label: string }> = [
  { key: 'uploaded', label: 'Uploaded date' },
  { key: 'organization', label: 'Organization' },
  { key: 'status', label: 'Status' },
  { key: 'sourceType', label: 'Source type' },
  { key: 'sourceValue', label: 'Source value' },
];

const statusDotColors: Record<UploadedStatus, string> = {
  Processing: '#E6A700',
  Processed: '#12B886',
  'Organization not identified': '#FF6200',
  Rejected: '#D64545',
  Exception: '#D64545',
  Duplicate: '#FF6200',
  'Not document': '#7288A3',
};

function uploadedTimestamp(document: DbDocument) {
  const created = Date.parse(document.created_at || '');
  if (Number.isFinite(created)) return created;
  const parts = (document.receive_date || '').match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  return parts
    ? new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1])).getTime()
    : 0;
}

function displayUploadedDate(document: DbDocument) {
  const timestamp = uploadedTimestamp(document);
  if (!timestamp) return document.receive_date || '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function uploadedStatus(document: DbDocument): UploadedStatus {
  const raw = (document.status || '').trim().toLowerCase();
  if (raw === 'rejected') return 'Rejected';
  if (raw === 'exception' || raw === 'exceptional') return 'Exception';
  if (raw.includes('duplicate') || raw.includes('dublicate')) return 'Duplicate';
  if (raw === 'not document' || raw === 'not documented') return 'Not document';
  if (!document.company_id) return 'Organization not identified';
  if (['paid', 'accepted', 'processed', 'completed', 'transferred', 'approved'].includes(raw)) {
    return 'Processed';
  }
  return 'Processing';
}

function statusGroup(status: UploadedStatus): StatusGroup {
  if (status === 'Processing') return 'Processing';
  if (status === 'Processed') return 'Processed';
  return 'Needs attention';
}

function statusReason(document: DbDocument, status: UploadedStatus) {
  if (status === 'Processed') return 'Initial processing completed and sent to Organization Documents.';
  if (status === 'Organization not identified') return 'The organization could not be identified during intake.';
  if (status === 'Duplicate') return 'A matching document already exists.';
  if (status === 'Rejected') return document.valid_form || 'The document failed intake validation.';
  if (status === 'Exception') return document.valid_form || 'OCR or integration processing requires review.';
  if (status === 'Not document') return 'The uploaded file was not recognized as a document.';
  return 'OCR extraction, analysis or validation is in progress.';
}

function sourceValue(document: DbDocument) {
  return document.created_by || document.source || 'Unknown source';
}

function uploadedVisibleSearchCells(document: DbDocument, organizationName: string) {
  const status = uploadedStatus(document);
  return [
    document.file_case || document.number || document.id,
    sourceValue(document),
    organizationName,
    status,
    statusReason(document, status),
    displayUploadedDate(document),
  ];
}

function isUnresolved(status: UploadedStatus) {
  return status === 'Processing' || statusGroup(status) === 'Needs attention';
}

export default function UploadedDocumentsView({
  onOpenDocument,
}: {
  onOpenDocument: (document: DbDocument) => void | Promise<void>;
}) {
  const [documents, setDocuments] = useState<DbDocument[]>([]);
  const [organizations, setOrganizations] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<StatusGroup>('All');
  const [showFilters, setShowFilters] = useState(false);
  const [openFilter, setOpenFilter] = useState<UploadedFilterKey | null>(null);
  const [visibleFilterKeys, setVisibleFilterKeys] = useState<UploadedFilterKey[]>([]);
  const [pendingFilterKeys, setPendingFilterKeys] = useState<UploadedFilterKey[]>([]);
  const [selectedFilterKeys, setSelectedFilterKeys] = useState<UploadedFilterKey[]>([]);
  const [dateFilter, setDateFilter] = useState('30');
  const [documentFilter, setDocumentFilter] = useState('');
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('');
  const [sourceValueFilter, setSourceValueFilter] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<DbDocument | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DbDocument | null>(null);
  const [assigningOrganization, setAssigningOrganization] = useState(false);
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [issueMode, setIssueMode] = useState(false);
  const [issueComment, setIssueComment] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [columns, setColumns] = useState<ColConfig[]>(() => UPLOADED_DOCUMENT_COLUMNS.map((column) => ({ ...column })));
  const { startResize } = useColumnResize(columns, setColumns);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    setLoading(true);
    const [documentResult, companyResult] = await Promise.all([
      supabase.from('documents').select('*'),
      supabase.from('companies').select('*'),
    ]);
    let loadedDocuments = (documentResult.data as unknown as DbDocument[] | null) ?? [];
    const hasUnassignedDocument = loadedDocuments.some((document) => !document.company_id);
    const hasTestDocument = loadedDocuments.some((document) => document.id === UNASSIGNED_TEST_DOCUMENT_ID);
    if (!hasUnassignedDocument && !hasTestDocument) {
      await supabase.from('documents').upsert({ ...UNASSIGNED_TEST_DOCUMENT }, { onConflict: 'id' });
      loadedDocuments = [UNASSIGNED_TEST_DOCUMENT, ...loadedDocuments];
    }
    const hasDuplicateTestDocument = loadedDocuments.some((document) => document.id === DUPLICATE_TEST_DOCUMENT_ID);
    if (!hasDuplicateTestDocument) {
      const duplicateSource = loadedDocuments.find((document) => (
        document.id !== UNASSIGNED_TEST_DOCUMENT_ID &&
        document.id !== DUPLICATE_TEST_DOCUMENT_ID &&
        !document.status?.toLowerCase().includes('duplicate') &&
        Boolean(document.company_id)
      ));
      if (duplicateSource) {
        const duplicateTestDocument: DbDocument = {
          ...duplicateSource,
          id: DUPLICATE_TEST_DOCUMENT_ID,
          status: 'Duplicate',
          created_at: '2026-08-28T10:00:00.000Z',
          created_by: 'duplicate-detection@meso.lt',
          valid_form: 'A matching original document was detected.',
        };
        await supabase.from('documents').upsert({ ...duplicateTestDocument }, { onConflict: 'id' });
        loadedDocuments = [duplicateTestDocument, ...loadedDocuments];
      }
    }
    setDocuments(loadedDocuments);
    setOrganizations((companyResult.data as unknown as Company[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!showFilters && openFilter === null && !searchSuggestionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterMenuRef.current?.contains(event.target)) {
        setShowFilters(false);
        setOpenFilter(null);
        setSearchSuggestionsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowFilters(false);
        setOpenFilter(null);
        setSearchSuggestionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openFilter, searchSuggestionsOpen, showFilters]);

  const organizationNames = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization.name])),
    [organizations],
  );

  const filteredDocuments = useMemo(() => {
    const cutoff = dateFilter === 'all'
      ? 0
      : Date.now() - Number(dateFilter || 30) * 24 * 60 * 60 * 1000;
    const normalizedDocument = documentFilter.trim().toLowerCase();
    const normalizedOrganization = organizationFilter.trim().toLowerCase();
    const normalizedSourceValue = sourceValueFilter.trim().toLowerCase();

    return [...documents]
      .sort((left, right) => uploadedTimestamp(right) - uploadedTimestamp(left))
      .filter((document) => {
        const status = uploadedStatus(document);
        const group = statusGroup(status);
        if (activeGroup !== 'All' && group !== activeGroup) return false;
        if (!isUnresolved(status) && cutoff && uploadedTimestamp(document) < cutoff) return false;
        const organizationName = organizationNames.get(document.company_id || '') || 'Organization not identified';
        if (normalizedDocument && !matchesTextSearch(uploadedVisibleSearchCells(document, organizationName), documentFilter)) return false;
        if (normalizedOrganization && !organizationName.toLowerCase().includes(normalizedOrganization)) return false;
        if (statusFilter && status !== statusFilter) return false;
        if (sourceTypeFilter && (document.source || '').toLowerCase() !== sourceTypeFilter.toLowerCase()) return false;
        if (normalizedSourceValue && !sourceValue(document).toLowerCase().includes(normalizedSourceValue)) return false;
        return true;
      });
  }, [activeGroup, dateFilter, documentFilter, documents, organizationFilter, organizationNames, sourceTypeFilter, sourceValueFilter, statusFilter]);

  const searchSuggestions = useMemo(() => {
    return getSearchSuggestions(
      filteredDocuments.map((document) => uploadedVisibleSearchCells(
        document,
        organizationNames.get(document.company_id || '') || 'Organization not identified',
      )),
      documentFilter,
    );
  }, [documentFilter, filteredDocuments, organizationNames]);

  const {
    sortedRows: sortedDocuments,
    changeSort,
    directionFor,
  } = useMultiColumnSort(filteredDocuments, (document, key: UploadedColumnKey) => {
    if (key === 'document') return document.file_case || document.number || document.id;
    if (key === 'organization') return organizationNames.get(document.company_id || '') || 'Organization not identified';
    if (key === 'status') return uploadedStatus(document);
    return uploadedTimestamp(document);
  });

  useEffect(() => setPage(1), [activeGroup, dateFilter, documentFilter, organizationFilter, statusFilter, sourceTypeFilter, sourceValueFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredDocuments.length / PAGE_SIZE));
  const safePage = showAll ? 1 : Math.min(page, pageCount);
  const pageDocuments = showAll
    ? sortedDocuments
    : sortedDocuments.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const sourceTypes = [...new Set(documents.map((document) => document.source).filter(Boolean))];
  const filterOptions: Record<UploadedFilterKey, Array<{ label: string; value: string }>> = {
    uploaded: [
      { label: 'Last 30 days', value: '30' },
      { label: 'Last 90 days', value: '90' },
      { label: 'Last 12 months', value: '365' },
      { label: 'All time', value: 'all' },
    ],
    organization: [
      { label: 'All', value: '' },
      ...[...new Set(organizations.map((organization) => organization.name).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ label: value, value })),
    ],
    status: [
      { label: 'All', value: '' },
      ...Object.keys(statusDotColors).map((value) => ({ label: value, value })),
    ],
    sourceType: [
      { label: 'All', value: '' },
      ...sourceTypes.map((value) => ({ label: value, value })),
    ],
    sourceValue: [
      { label: 'All', value: '' },
      ...[...new Set(documents.map(sourceValue).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ label: value, value })),
    ],
  };
  const assignmentOptions = organizations.filter((organization) => {
    const query = organizationSearch.trim().toLowerCase();
    return !query || `${organization.name} ${organization.company_code || ''}`.toLowerCase().includes(query);
  });

  const assignOrganization = async (organization: Company) => {
    if (!selectedDocument) return;
    await supabase.from('documents').upsert(
      { ...selectedDocument, company_id: organization.id },
      { onConflict: 'id' },
    );
    const updated = { ...selectedDocument, company_id: organization.id };
    setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document));
    setSelectedDocument(updated);
    setAssigningOrganization(false);
    setOrganizationSearch('');
    setNotice(`Assigned to ${organization.name}.`);
  };

  const reportIssue = async () => {
    if (!selectedDocument || !issueComment.trim()) return;
    const updated = {
      ...selectedDocument,
      status: 'Exception',
      valid_form: `OCR issue: ${issueComment.trim()}`,
    };
    await supabase.from('documents').upsert(updated, { onConflict: 'id' });
    const historyKey = `finansu-harmonija:v12:ocr-issue-thread:${selectedDocument.id}`;
    const currentHistory = JSON.parse(window.localStorage.getItem(historyKey) || '[]') as unknown[];
    window.localStorage.setItem(historyKey, JSON.stringify([
      ...currentHistory,
      { comment: issueComment.trim(), createdAt: new Date().toISOString(), destination: 'MESO Worker / OCR review' },
    ]));
    setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document));
    setSelectedDocument(updated);
    setIssueComment('');
    setIssueMode(false);
    setNotice('OCR issue sent to MESO Worker for review.');
  };

  const closeSidePanel = () => {
    setSelectedDocument(null);
    setAssigningOrganization(false);
    setOrganizationSearch('');
    setIssueMode(false);
    setIssueComment('');
  };

  const openUploadedDocument = (document: DbDocument) => {
    setSelectedDocument(null);
    setNotice('');
    setPreviewDocument(document);
  };

  useEffect(() => {
    if (!previewDocument) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewDocument(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewDocument]);

  const clearFilterValue = (key: UploadedFilterKey) => {
    if (key === 'uploaded') setDateFilter('30');
    if (key === 'organization') setOrganizationFilter('');
    if (key === 'status') setStatusFilter('');
    if (key === 'sourceType') setSourceTypeFilter('');
    if (key === 'sourceValue') setSourceValueFilter('');
    setSelectedFilterKeys((current) => current.filter((filterKey) => filterKey !== key));
    setPage(1);
  };

  const currentFilterValue = (key: UploadedFilterKey) => {
    if (key === 'uploaded') return dateFilter;
    if (key === 'organization') return organizationFilter;
    if (key === 'status') return statusFilter;
    if (key === 'sourceType') return sourceTypeFilter;
    return sourceValueFilter;
  };

  const setCurrentFilterValue = (key: UploadedFilterKey, value: string) => {
    if (key === 'uploaded') setDateFilter(value);
    if (key === 'organization') setOrganizationFilter(value);
    if (key === 'status') setStatusFilter(value);
    if (key === 'sourceType') setSourceTypeFilter(value);
    if (key === 'sourceValue') setSourceValueFilter(value);
    setSelectedFilterKeys((current) => current.includes(key) ? current : [...current, key]);
    setPage(1);
  };

  const applyPendingFilters = () => {
    const addedFilterKeys = pendingFilterKeys.filter((key) => !visibleFilterKeys.includes(key));
    visibleFilterKeys
      .filter((key) => !pendingFilterKeys.includes(key))
      .forEach(clearFilterValue);
    if (addedFilterKeys.includes('uploaded')) {
      setSelectedFilterKeys((current) => current.includes('uploaded') ? current : [...current, 'uploaded']);
    }
    setVisibleFilterKeys(pendingFilterKeys);
    setShowFilters(false);
  };

  const originalForDuplicate = selectedDocument && uploadedStatus(selectedDocument) === 'Duplicate'
    ? documents.find((document) => document.id !== selectedDocument.id && (
        (selectedDocument.number && document.number === selectedDocument.number) ||
        (selectedDocument.file_case && document.file_case === selectedDocument.file_case)
      ))
    : undefined;

  const originalForDocument = (document: DbDocument) => uploadedStatus(document) === 'Duplicate'
    ? documents.find((candidate) => candidate.id !== document.id && (
        (document.number && candidate.number === document.number) ||
        (document.file_case && candidate.file_case === document.file_case)
      ))
    : undefined;

  return (
    <div
      className="relative flex min-h-full min-w-0 flex-col gap-8 bg-white px-4 py-14 sm:px-8 lg:px-[72px]"
    >
      <PageHeader title="Uploaded documents" />
      <SystemBreadcrumb items={["Uploaded documents"]} />

      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <div className="system-table-toolbar relative h-7 min-h-7 flex-shrink-0">
          <div ref={filterMenuRef} className="flex h-7 min-h-7 min-w-0 flex-row flex-nowrap items-center gap-1">
            <div data-native-system-filters className="relative flex-shrink-0">
              <OcrSearchField
                value={documentFilter}
                onChange={(value) => {
                  setDocumentFilter(value);
                  setSearchSuggestionsOpen(Boolean(value.trim()));
                  setHighlightedSuggestion(0);
                  setPage(1);
                }}
                onFocus={() => setSearchSuggestionsOpen(Boolean(documentFilter.trim()))}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchSuggestionsOpen(false);
                    return;
                  }
                  if (!searchSuggestions.length) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSearchSuggestionsOpen(true);
                    setHighlightedSuggestion((current) => Math.min(current + 1, searchSuggestions.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setHighlightedSuggestion((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === 'Enter' && searchSuggestionsOpen) {
                    event.preventDefault();
                    setDocumentFilter(searchSuggestions[highlightedSuggestion] ?? documentFilter);
                    setSearchSuggestionsOpen(false);
                    setPage(1);
                  }
                }}
                ariaExpanded={searchSuggestionsOpen && searchSuggestions.length > 0}
                ariaControls="uploaded-document-search-suggestions"
                ariaLabel="Search uploaded documents"
              />
              {searchSuggestionsOpen && searchSuggestions.length > 0 && (
                <div
                  id="uploaded-document-search-suggestions"
                  role="listbox"
                  aria-label="Uploaded document search suggestions"
                  className="absolute left-0 top-[32px] z-50 w-[320px] overflow-hidden rounded-lg border border-[#D3E1EC] bg-white p-1.5 shadow-[0_8px_24px_rgba(16,35,58,0.14)]"
                >
                  {searchSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      type="button"
                      role="option"
                      aria-selected={highlightedSuggestion === index}
                      onMouseEnter={() => setHighlightedSuggestion(index)}
                      onClick={() => {
                        setDocumentFilter(suggestion);
                        setSearchSuggestionsOpen(false);
                        setPage(1);
                      }}
                      className={`flex min-h-9 w-full items-center rounded-md px-3 py-2 text-left font-montserrat text-[12px] font-medium leading-[18px] text-[#10233A] ${highlightedSuggestion === index ? 'bg-[#F2F7FC]' : 'hover:bg-[#F2F7FC]'}`}
                    >
                      <span className="truncate">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          <div className="flex flex-nowrap items-center gap-1" role="tablist" aria-label="Uploaded document groups">
            {(['All', 'Processing', 'Needs attention', 'Processed'] as StatusGroup[]).map((group) => (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={activeGroup === group}
                onClick={() => setActiveGroup(group)}
                className={`flex h-7 items-center rounded px-3 font-montserrat text-[12px] font-medium leading-[18px] transition-colors ${activeGroup === group ? 'bg-[#007EA7] text-white' : 'bg-[#E5EDF9] text-[#7288A3] hover:bg-[#DCE7F6]'}`}
              >
                {group}
              </button>
            ))}
          </div>
          {visibleFilterKeys.map((key) => {
            const filter = UPLOADED_FILTERS.find((item) => item.key === key);
            if (!filter) return null;
            const value = currentFilterValue(key);
            const hasSelection = selectedFilterKeys.includes(key);
            const displayValue = filterOptions[key].find((option) => option.value === value)?.label || 'All';
            const isOpen = openFilter === key;
            return (
              <div key={key} className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpenFilter((current) => current === key ? null : key);
                    setShowFilters(false);
                  }}
                  aria-expanded={isOpen}
                  aria-label={`Filter by ${filter.label}`}
                  className="flex h-7 max-w-[240px] items-center gap-1 rounded bg-[#E5EDF9] px-2 py-[5px] font-montserrat text-[12px] font-medium leading-[18px] text-[#7288A3] hover:bg-[#DCE7F6]"
                >
                  <span className="truncate whitespace-nowrap">
                    {filter.label}{hasSelection && <>: <span className="text-[#10233A]">{displayValue}</span></>}
                  </span>
                  {hasSelection ? (
                    <X
                      size={15}
                      className="flex-shrink-0"
                      onClick={(event) => {
                        event.stopPropagation();
                        clearFilterValue(key);
                        setOpenFilter(null);
                      }}
                    />
                  ) : (
                    <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  )}
                </button>
                {isOpen && (
                  <div className="absolute left-0 top-[32px] z-40 min-w-[220px] overflow-hidden rounded-lg border border-[#D3E1EC] bg-white py-1 shadow-[0_8px_24px_rgba(16,35,58,0.14)]">
                    <div className="max-h-[240px] overflow-y-auto">
                      {filterOptions[key].map((option) => {
                        const checked = hasSelection && value === option.value;
                        return (
                          <button
                            key={`${key}-${option.value}`}
                            type="button"
                            onClick={() => {
                              setCurrentFilterValue(key, option.value);
                              setOpenFilter(null);
                            }}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#F2F7FC]"
                          >
                            <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border ${checked ? 'border-[#007EA7] bg-[#007EA7]' : 'border-[#A1B6C6] bg-white'}`}>
                              {checked && <Check size={13} strokeWidth={2.5} className="text-white" />}
                            </span>
                            <span className="font-montserrat text-[13px] font-medium text-[#10233A]">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setPendingFilterKeys(visibleFilterKeys);
                setShowFilters((current) => !current);
                setOpenFilter(null);
              }}
              aria-expanded={showFilters}
              className="flex h-7 items-center gap-1 rounded bg-[#E5EDF9] px-2 py-[5px] font-montserrat text-[12px] font-medium leading-[18px] text-[#7288A3] hover:bg-[#DCE7F6]"
            >
              <Plus size={15} />
              Add filters
            </button>
            {showFilters && (
              <div
                className="absolute left-0 top-[32px] z-40 min-w-[240px] overflow-hidden rounded-lg border border-[#D3E1EC] bg-white p-1.5 shadow-[0_8px_24px_rgba(16,35,58,0.14)]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyPendingFilters();
                  }
                }}
              >
                <div className="max-h-[300px] overflow-y-auto">
                  {UPLOADED_FILTERS.map((filter) => {
                    const checked = pendingFilterKeys.includes(filter.key);
                    return (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setPendingFilterKeys((current) => checked
                          ? current.filter((key) => key !== filter.key)
                          : [...current, filter.key])}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[#F2F7FC]"
                      >
                        <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border ${checked ? 'border-[#007EA7] bg-[#007EA7]' : 'border-[#A1B6C6] bg-white'}`}>
                          {checked && <Check size={13} strokeWidth={2.5} className="text-white" />}
                        </span>
                        <span className="font-montserrat text-[13px] font-medium text-[#10233A]">{filter.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-[#E5EDF9] px-2 pt-2">
                  <span className="font-montserrat text-[11px] text-[#7288A3]">Enter to apply</span>
                  <button type="button" onClick={applyPendingFilters} className="h-8 rounded-md bg-[#007EA7] px-3 font-montserrat text-[12px] font-semibold text-white hover:bg-[#006D91]">
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {notice && <div className="rounded-lg bg-[#EAF8F3] px-4 py-2 font-montserrat text-[12px] font-medium text-[#008A6A]">{notice}</div>}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-12 bg-white">
        <div ref={tableScrollRef} className="min-h-0 flex-1 overflow-x-auto scrollbar-hide">
          <div style={{ minWidth: `${columns.reduce((sum, column) => sum + column.width + 12, 0) + 24}px` }}>
            <div className="mb-4 flex h-5 flex-row items-center gap-3 pl-3">
              {columns.map((column, index) => (
                <div key={column.key} className="flex flex-shrink-0 flex-row items-center">
                  <div
                    className="relative flex flex-shrink-0 flex-row items-center gap-[6px]"
                    style={{ width: column.width }}
                  >
                    <span className="min-w-0 truncate font-montserrat text-[12px] font-medium leading-[18px] text-[#10233A]">
                      {column.label}
                    </span>
                    <ColumnSortButton
                      columnLabel={column.label}
                      direction={directionFor(column.key as UploadedColumnKey)}
                      onDirectionChange={(direction) => {
                        changeSort(column.key as UploadedColumnKey, direction);
                        setPage(1);
                      }}
                    />
                    <ResizeHandle onMouseDown={(event) => startResize(index, event)} />
                  </div>
                </div>
              ))}
            </div>

          {loading ? (
            <div className="flex min-h-44 items-center justify-center font-montserrat text-[13px] text-[#7288A3]">Loading uploaded documents…</div>
          ) : pageDocuments.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
              <FileText size={28} className="text-[#A1B6C6]" />
              <span className="font-montserrat text-[13px] font-semibold text-[#10233A]">No uploaded documents found</span>
            </div>
          ) : pageDocuments.map((document, index) => {
            const status = uploadedStatus(document);
            const organizationName = organizationNames.get(document.company_id || '');
            const duplicateOriginal = originalForDocument(document);
            const isSelected = selectedDocument?.id === document.id;
            return (
              <div
                key={document.id}
                role="row"
                tabIndex={0}
                onClick={() => {
                  setSelectedDocument(isSelected ? null : document);
                  setAssigningOrganization(false);
                  setIssueMode(false);
                  setNotice('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setSelectedDocument(isSelected ? null : document);
                }}
                className={`flex h-9 w-full cursor-pointer flex-row items-center rounded-lg px-3 transition-colors ${index % 2 === 0 ? 'bg-[#F8FDFF]' : 'bg-white'} ${isSelected ? '!bg-[#EAF4F8]' : 'hover:bg-[#E7F4F9]'}`}
              >
                <div className="flex h-9 min-w-0 flex-1 flex-row items-center gap-3 py-0.5">
                <div className="min-w-0 flex-shrink-0" style={{ width: columns[0].width }}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openUploadedDocument(document);
                    }}
                    className="block max-w-full truncate text-left font-montserrat text-[12px] font-normal leading-[18px] text-[#007EA7]"
                    title={document.file_case || document.number || document.id}
                  >
                    {document.file_case || document.number || document.id}
                  </button>
                  <span className="block max-w-full truncate font-montserrat text-[11px] font-normal leading-[14px] text-[#7288A3]" title={sourceValue(document)}>
                    {sourceValue(document)}
                  </span>
                </div>
                <div className="min-w-0 flex-shrink-0" style={{ width: columns[1].width }}>
                  {organizationName ? (
                    <span className="block truncate font-montserrat text-[12px] font-normal leading-[18px] text-[#10233A]">{organizationName}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedDocument(document);
                        setAssigningOrganization(true);
                      }}
                      className="font-montserrat text-[11px] font-semibold text-[#007EA7]"
                    >
                      Assign organization
                    </button>
                  )}
                </div>
                <div className="min-w-0 flex-shrink-0" style={{ width: columns[2].width }}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: statusDotColors[status] }} />
                    <span className="flex-shrink-0 font-montserrat text-[12px] font-normal leading-[18px] text-[#10233A]">{status}</span>
                    {status === 'Duplicate' && duplicateOriginal && (
                      <>
                        <span className="flex-shrink-0 font-montserrat text-[12px] text-[#A1B6C6]">·</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onOpenDocument(duplicateOriginal);
                          }}
                          className="min-w-0 truncate text-left font-montserrat text-[12px] font-medium leading-[18px] text-[#007EA7] hover:underline"
                          title={`Open original document ${duplicateOriginal.file_case || duplicateOriginal.number || duplicateOriginal.id}`}
                        >
                          {duplicateOriginal.file_case || duplicateOriginal.number || duplicateOriginal.id}
                        </button>
                      </>
                    )}
                  </div>
                  <span className="block max-w-full truncate font-montserrat text-[11px] font-normal leading-[14px] text-[#7288A3]" title={statusReason(document, status)}>
                    {statusReason(document, status)}
                  </span>
                </div>
                <span className="flex-shrink-0 font-montserrat text-[12px] font-normal leading-[18px] text-[#10233A]" style={{ width: columns[3].width }}>{displayUploadedDate(document)}</span>
                </div>
              </div>
            );
          })}
          </div>
        </div>
        <HorizontalTableScrollbar scrollRef={tableScrollRef} className="uploaded-documents-scrollbar" />
        <div className="flex flex-shrink-0 flex-row flex-wrap items-center justify-between gap-4">
          <TablePagination
            currentPage={safePage}
            totalPages={showAll ? 1 : pageCount}
            itemCount={filteredDocuments.length}
            itemsPerPage={showAll ? Math.max(1, filteredDocuments.length) : PAGE_SIZE}
            onPageChange={showAll ? () => undefined : setPage}
            onShowMore={() => {
              setShowAll((current) => !current);
              setPage(1);
            }}
            showMoreLabel={showAll ? 'Default' : 'Show more'}
            allItemsVisible={showAll}
          />
        </div>
        </section>
      </div>

      {previewDocument && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#10233A]/25 p-4 sm:p-6"
          onMouseDown={() => setPreviewDocument(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Document preview ${previewDocument.file_case || previewDocument.number || previewDocument.id}`}
            className="flex h-[min(900px,94vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[#E5EDF9] px-6">
              <div className="min-w-0">
                <h2 className="truncate font-montserrat text-[18px] font-semibold text-[#10233A]">
                  {previewDocument.file_case || previewDocument.number || previewDocument.id}
                </h2>
                <p className="font-montserrat text-[11px] font-normal text-[#7288A3]">Original uploaded document · Read-only</p>
              </div>
              <button
                type="button"
                aria-label="Close document preview"
                onClick={() => setPreviewDocument(null)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-[#7288A3] transition-colors hover:text-[#10233A]"
              >
                <X size={22} />
              </button>
            </header>
            <div className="min-h-0 flex-1 bg-[#EEF3F7] p-3 sm:p-5">
              {previewDocument.image_url && (previewDocument.image_url.startsWith('data:image/') || /\.(png|jpe?g|gif|webp|tiff?)($|\?)/i.test(previewDocument.image_url)) ? (
                <img
                  src={previewDocument.image_url}
                  alt={`Uploaded document ${previewDocument.file_case || previewDocument.number || previewDocument.id}`}
                  className="h-full w-full object-contain"
                />
              ) : previewDocument.image_url ? (
                <object
                  data={previewDocument.image_url}
                  type="application/pdf"
                  aria-label={`Uploaded PDF ${previewDocument.file_case || previewDocument.number || previewDocument.id}`}
                  className="h-full w-full rounded-lg bg-white"
                >
                  <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg bg-white px-8 text-center">
                    <FileText size={36} className="text-[#007EA7]" />
                    <p className="font-montserrat text-[13px] font-medium text-[#10233A]">This browser cannot display the uploaded document.</p>
                    <a href={previewDocument.image_url} target="_blank" rel="noreferrer" className="font-montserrat text-[13px] font-semibold text-[#007EA7]">Open document</a>
                  </div>
                </object>
              ) : (
                <div className="h-full overflow-y-auto rounded-lg bg-[#E9EFF4] p-5 sm:p-8">
                  <article className="mx-auto min-h-full w-full max-w-[760px] bg-white px-8 py-10 shadow-sm sm:px-14 sm:py-12">
                    <header className="flex items-start justify-between gap-8 border-b border-[#D3E1EC] pb-7">
                      <div className="min-w-0">
                        <p className="font-montserrat text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7288A3]">Uploaded document</p>
                        <h3 className="mt-2 break-words font-montserrat text-[24px] font-semibold leading-8 text-[#10233A]">
                          {previewDocument.file_case || previewDocument.number || previewDocument.id}
                        </h3>
                      </div>
                      <FileText size={42} strokeWidth={1.4} className="flex-shrink-0 text-[#007EA7]" />
                    </header>
                    <dl className="mt-8 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
                      {[
                        ['Document type', previewDocument.document_type || previewDocument.type || '—'],
                        ['Document number', previewDocument.number || '—'],
                        ['Organization', organizationNames.get(previewDocument.company_id || '') || '—'],
                        ['Client / Counterparty', previewDocument.client_counterparty || '—'],
                        ['Document date', previewDocument.document_date || '—'],
                        ['Received', displayUploadedDate(previewDocument)],
                        ['Currency', previewDocument.currency || '—'],
                        ['Total amount', previewDocument.total_amount || '—'],
                        ['Source', previewDocument.source || '—'],
                        ['Source value', sourceValue(previewDocument)],
                      ].map(([label, value]) => (
                        <div key={label} className="border-b border-[#E5EDF9] pb-3">
                          <dt className="font-montserrat text-[11px] font-semibold text-[#7288A3]">{label}</dt>
                          <dd className="mt-1 break-words font-montserrat text-[13px] font-normal leading-5 text-[#10233A]">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedDocument && (
        <>
          <button
            type="button"
            aria-label="Close document details"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeSidePanel();
            }}
            className="fixed inset-0 z-[69] cursor-default bg-transparent"
          />
          <aside className="fixed bottom-0 right-0 top-0 z-[70] flex w-[390px] max-w-[calc(100vw-24px)] flex-col border-l border-[#D3E1EC] bg-white shadow-[-12px_0_32px_rgba(16,35,58,0.12)]">
            <div className="border-b border-[#D3E1EC] px-6 py-5">
              <h2 className="truncate font-montserrat text-[18px] font-semibold text-[#10233A]">{selectedDocument.file_case || selectedDocument.number || selectedDocument.id}</h2>
              <p className="mt-1 font-montserrat text-[11px] font-medium text-[#7288A3]">Click anywhere outside this panel to close it.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <dl className="space-y-4">
                {[
                  ['Status', uploadedStatus(selectedDocument)],
                  ['Reason', statusReason(selectedDocument, uploadedStatus(selectedDocument))],
                  ['Organization', organizationNames.get(selectedDocument.company_id || '') || 'Organization not identified'],
                  ['Source', selectedDocument.source || '—'],
                  ['Source value', sourceValue(selectedDocument)],
                  ['Uploaded', displayUploadedDate(selectedDocument)],
                  ['Processed', uploadedStatus(selectedDocument) === 'Processed' ? displayUploadedDate(selectedDocument) : '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-montserrat text-[11px] font-semibold text-[#7288A3]">{label}</dt>
                    <dd className="mt-1 whitespace-normal font-montserrat text-[13px] font-medium leading-5 text-[#10233A]">{value}</dd>
                  </div>
                ))}
              </dl>

              {assigningOrganization && (
                <section className="mt-6 rounded-xl border border-[#D3E1EC] p-4">
                  <label className="relative block">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7288A3]" />
                    <input value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} placeholder="Search name or company code" className="h-9 w-full rounded-lg border border-[#D3E1EC] pl-9 pr-3 font-montserrat text-[12px] outline-none focus:border-[#007EA7]" />
                  </label>
                  <div className="mt-3 max-h-56 overflow-y-auto">
                    {assignmentOptions.map((organization) => (
                      <button key={organization.id} type="button" onClick={() => void assignOrganization(organization)} className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-[#EEF7FA]">
                        <span className="font-montserrat text-[12px] font-semibold text-[#10233A]">{organization.name}</span>
                        <span className="font-montserrat text-[11px] text-[#7288A3]">{organization.company_code || 'No company code'}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {issueMode && (
                <section className="mt-6 rounded-xl border border-[#D3E1EC] p-4">
                  <label className="font-montserrat text-[12px] font-semibold text-[#10233A]">
                    Required comment <span className="text-[#D64545]">*</span>
                  </label>
                  <textarea value={issueComment} onChange={(event) => setIssueComment(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-lg border border-[#D3E1EC] p-3 font-montserrat text-[12px] outline-none focus:border-[#007EA7]" />
                  <button type="button" disabled={!issueComment.trim()} onClick={() => void reportIssue()} className="mt-3 h-9 w-full rounded-lg bg-[#007EA7] font-montserrat text-[12px] font-semibold text-white disabled:opacity-40">Send to OCR review</button>
                </section>
              )}

              {originalForDuplicate && (
                <button type="button" onClick={() => void onOpenDocument(originalForDuplicate)} className="mt-6 font-montserrat text-[12px] font-semibold text-[#007EA7]">Open original document</button>
              )}
            </div>
            <footer className="space-y-3 border-t border-[#D3E1EC] px-6 py-5">
              {uploadedStatus(selectedDocument) === 'Processed' && selectedDocument.company_id && (
                <button type="button" onClick={() => void onOpenDocument(selectedDocument)} className="h-[42px] w-full rounded-lg bg-[#007EA7] font-montserrat text-[14px] font-semibold text-white">Open in organization</button>
              )}
              {!selectedDocument.company_id && (
                <button type="button" onClick={() => setAssigningOrganization(true)} className="h-[42px] w-full rounded-lg border-2 border-[#D3E1EC] bg-white font-montserrat text-[14px] font-semibold text-[#007EA7]">Assign organization</button>
              )}
              <button type="button" onClick={() => setIssueMode(true)} className="flex h-[42px] w-full items-center justify-center gap-2 rounded-lg border-2 border-[#D3E1EC] bg-white font-montserrat text-[14px] font-semibold text-[#7288A3]"><AlertCircle size={16} />Report OCR issue</button>
            </footer>
          </aside>
        </>
      )}
    </div>
  );
}
