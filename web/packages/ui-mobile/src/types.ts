/** 公私域：由后端 domainTag 字段给出，前端不自行推导（见 docs/02 §1-6） */
export type Domain = 'PRIVATE' | 'PUBLIC' | 'TEMP_PRIVATE'

/** 用户状态：6 个运行态（见 docs/04 D-08） */
export type UserStatus =
  | 'GUEST'
  | 'PUBLIC_SEEKING'
  | 'PRIVATE_PENDING'
  | 'PENDING_INTERVIEW'
  | 'PENDING_CONFIRM'
  | 'EMPLOYED'
