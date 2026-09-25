"use client";

import { useId, useMemo } from "react";
import { DashboardCustomSelect } from "@/app/components/dashboard/DashboardCustomSelect";
import type { DashboardSelectOption } from "@/app/components/dashboard/DashboardCustomSelect";
import { FiltersSortPanel } from "@/app/components/dashboard/FiltersSortPanel";
import {
  FilterField,
  FilterForm,
  FilterInput,
  FilterLabel,
  FilterRow,
  FilterSegment,
  FilterSegmentItem,
  FilterSubmitBtn,
  FilterSubmitWrap,
} from "@/app/components/dashboard/list-filters-ui";
import {
  ListFiltersTimeRangeSection,
  listFiltersRangeSummary,
} from "@/app/components/dashboard/ListFiltersTimeRangeSection";
import { ClientListSortRow } from "@/app/components/dashboard/ClientListSortRow";
import { listTimeRangeHiddenFields, type ParsedTimeRange } from "@/lib/time-range";
import { releaseFilterSelectOptions } from "@/lib/overview-scope-url";

export const SESSIONS_SORT_OPTIONS: DashboardSelectOption[] = [
  { value: "started_at", label: "Started" },
  { value: "ended_at", label: "Ended" },
  { value: "duration", label: "Duration" },
  { value: "events", label: "Events" },
  { value: "pages", label: "Pages" },
  { value: "status", label: "Status" },
  { value: "session_id", label: "Session ID" },
  { value: "app", label: "App" },
  { value: "platform", label: "Platform" },
  { value: "user_id", label: "User ID" },
];

type Props = {
  path: string;
  currentParams: Record<string, string>;
  timeRange: ParsedTimeRange;
  fromParam: string;
  toParam: string;
  appFilter: string;
  pageSize: string;
  defaultPageSize: number;
  q: string;
  environment: string;
  release: string;
  country: string;
  platform: string;
  sort: string;
  order: string;
  environments: string[];
  releases: string[];
  countries: string[];
  platforms: string[];
  /** When set, sort/order apply client-side without a full page navigation. */
  onSortApply?: (sort: string, order: string) => void;
  sortLoading?: boolean;
  /** Visits uses the same filters without a sortable table. */
  hideSort?: boolean;
};

export function SessionsListToolbar({
  path,
  currentParams,
  timeRange,
  fromParam,
  toParam,
  appFilter,
  pageSize,
  defaultPageSize,
  q,
  environment,
  release,
  country,
  platform,
  sort,
  order,
  environments,
  releases,
  countries,
  platforms,
  onSortApply,
  sortLoading = false,
  hideSort = false,
}: Props) {
  const fieldIds = useId();
  const rangeSummary = listFiltersRangeSummary(timeRange.key, timeRange.label);
  const timeHidden = listTimeRangeHiddenFields(
    timeRange,
    fromParam,
    toParam,
    currentParams.metricsUntil
  );
  const pickerRange = {
    key: timeRange.key,
    label: timeRange.label,
    shortLabel: timeRange.shortLabel,
    gte: fromParam || timeRange.gte.toISOString(),
    lte: toParam || timeRange.lte.toISOString(),
  };

  const environmentOptions: DashboardSelectOption[] = useMemo(
    () => [
      { value: "", label: "Any" },
      ...environments.map((e) => ({ value: e, label: e })),
    ],
    [environments]
  );
  const releaseOptions: DashboardSelectOption[] = useMemo(
    () => releaseFilterSelectOptions(releases),
    [releases]
  );
  const countryOptions: DashboardSelectOption[] = useMemo(
    () => [
      { value: "", label: "Any" },
      ...countries.map((e) => ({ value: e, label: e })),
    ],
    [countries]
  );
  const platformOptions: DashboardSelectOption[] = useMemo(
    () => [
      { value: "", label: "Any" },
      ...platforms.map((e) => ({ value: e, label: e })),
    ],
    [platforms]
  );

  const id = (suffix: string) => `${fieldIds.replace(/:/g, "")}-${suffix}`;

  return (
    <FiltersSortPanel rangeSummary={rangeSummary}>
      <ListFiltersTimeRangeSection
        path={path}
        currentParams={currentParams}
        parsedRange={pickerRange}
        includeAll
      />

      <FilterForm method="get" action={path}>
        {appFilter ? <input type="hidden" name="app" value={appFilter} /> : null}
        {Object.entries(timeHidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {Number(pageSize) !== defaultPageSize ? (
          <input type="hidden" name="pageSize" value={pageSize} />
        ) : null}
        {currentParams.chartBucket ? (
          <input type="hidden" name="chartBucket" value={currentParams.chartBucket} />
        ) : null}
        {onSortApply ? (
          <>
            <input type="hidden" name="sort" value={sort || "started_at"} />
            <input type="hidden" name="order" value={order || "desc"} />
          </>
        ) : null}

        <FilterRow>
          <FilterField grow>
            <FilterLabel>Search</FilterLabel>
            <FilterInput
              type="search"
              name="q"
              defaultValue={q}
              placeholder="User id, email, country, device…"
              autoComplete="off"
            />
          </FilterField>
          <FilterField>
            <FilterLabel id={id("env-l")}>Environment</FilterLabel>
            <DashboardCustomSelect
              name="environment"
              value={environment}
              options={environmentOptions}
              triggerId={id("env-t")}
              listLabelledBy={id("env-l")}
            />
          </FilterField>
          <FilterField>
            <FilterLabel id={id("rel-l")}>Release</FilterLabel>
            <DashboardCustomSelect
              name="release"
              value={release}
              options={releaseOptions}
              triggerId={id("rel-t")}
              listLabelledBy={id("rel-l")}
            />
          </FilterField>
        </FilterRow>

        <FilterRow>
          <FilterField>
            <FilterLabel id={id("country-l")}>Country</FilterLabel>
            <DashboardCustomSelect
              name="country"
              value={country}
              options={countryOptions}
              triggerId={id("country-t")}
              listLabelledBy={id("country-l")}
            />
          </FilterField>
          <FilterField>
            <FilterLabel id={id("plat-l")}>Platform</FilterLabel>
            <DashboardCustomSelect
              name="platform"
              value={platform}
              options={platformOptions}
              triggerId={id("plat-t")}
              listLabelledBy={id("plat-l")}
            />
          </FilterField>
          {onSortApply || hideSort ? (
            <FilterSubmitWrap>
              <FilterSubmitBtn>Apply filters</FilterSubmitBtn>
            </FilterSubmitWrap>
          ) : null}
        </FilterRow>

        {hideSort ? null : onSortApply ? (
          <ClientListSortRow
            sort={sort || "started_at"}
            order={order}
            sortOptions={SESSIONS_SORT_OPTIONS}
            onApply={onSortApply}
            isLoading={sortLoading}
          />
        ) : (
          <FilterRow>
            <FilterField>
              <FilterLabel id={id("sort-l")}>Sort by</FilterLabel>
              <DashboardCustomSelect
                name="sort"
                value={sort || "started_at"}
                options={SESSIONS_SORT_OPTIONS}
                triggerId={id("sort-t")}
                listLabelledBy={id("sort-l")}
              />
            </FilterField>

            <FilterSegment
              legend="Order"
              title="Descending vs ascending order for the selected column."
              ariaLabel="Sort order"
            >
              <FilterSegmentItem name="order" value="desc" defaultChecked={order !== "asc"}>
                Desc
              </FilterSegmentItem>
              <FilterSegmentItem name="order" value="asc" defaultChecked={order === "asc"}>
                Asc
              </FilterSegmentItem>
            </FilterSegment>

            <FilterSubmitWrap>
              <FilterSubmitBtn>Apply</FilterSubmitBtn>
            </FilterSubmitWrap>
          </FilterRow>
        )}
      </FilterForm>
    </FiltersSortPanel>
  );
}
