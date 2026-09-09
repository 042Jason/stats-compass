// KOSIS 응답 타입 및 내부 정제 타입

export interface KosisListItem {
  LIST_ID?: string;
  LIST_NM?: string;
  ORG_ID?: string;
  TBL_ID?: string;
  TBL_NM?: string;
  STAT_NM?: string;
  VW_CD?: string;
  STAT_ID?: string;
  SEND_DE?: string;
  REC_TBL_SE?: string;
  UP_ID?: string;
  SEQ_NO?: string;
  LINK_URL?: string;
  UP_LIST_ID?: string;
  FULL_PATH_ID?: string;
}

export interface KosisTableMeta {
  ORG_ID: string;
  ORG_NM?: string;
  TBL_ID: string;
  TBL_NM: string;
  STAT_NM?: string;
  MAINC_NM?: string;
  COLLECT_CYCLE?: string;
  PRP_CNT?: string;
  LAWFUL_BAS?: string;
  STATS_TARGET?: string;
  RESN_TXT?: string;
  UPDATE_DT?: string;
  START_PRD_DE?: string;
  END_PRD_DE?: string;
  /** 통계설명자료는 항목이 51종이라 선언되지 않은 키가 많습니다 */
  [key: string]: unknown;
}

export interface CollectedTable {
  org_id: string;
  tbl_id: string;
  tbl_nm: string;
  stat_nm: string;
  /** 기관별 트리(MT_OTITLE)에서 이 표가 속한 '조사' 이름 — 트리 1단계 노드 */
  survey_name?: string;
  /** KOSIS 통계조사ID (목록 API 의 STAT_ID) */
  kosis_stat_id?: string;
  category_path: string;
  full_path_id?: string;
  link_url?: string;
}

export interface EnrichedTable extends CollectedTable {
  meta?: KosisTableMeta;
  meta_error?: string;
}

export interface BuiltStatistic {
  stat_id: string;
  stat_nm: string;
  agency: string;
  org_id: string;
  category: string;
  legal_basis?: string;
  purpose?: string;
  target?: string;
  method?: string;
  frequency?: string;
  tags?: string[];
  tables: {
    kosis_org_id: string;
    kosis_tbl_id: string;
    table_name: string;
    category_path: string;
    is_representative: boolean;
    kosis_url: string;
    latest_period?: string;
  }[];
  raw_meta: any;
}
