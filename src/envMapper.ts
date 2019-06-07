interface EnviromentConfig {
  PREFIX: string
  VERSION: string
  DB_DATABASE: string
  DB_USER: string
  DB_PASSWORD: string
  DB_SERVER: string
  DB_TRANSACTION_LIMIT: string
  DB_CONNECTION_TIMEOUT: string
  DB_REQUEST_TIMEOUT: string
  STORAGE_SERVICE: string
  SHAPES_CONTAINER: string
  SHAPES_REGION: string
  SHAPES_SKIP: string
}

interface ImporterConfig extends EnviromentConfig {
  KEYVALUE: string
  KEYVALUE_VERSION_TABLE: string
  KEYVALUE_REGION: string
}

interface WorkerConfig extends EnviromentConfig {
  AT_API_KEY: string
  AGENDA21_API_KEY: string
}

class EnvMapper {
  toEnvironmental(
    config,
    subset
  ): EnviromentConfig | ImporterConfig | WorkerConfig {
    const base = {
      PREFIX: config.prefix,
      VERSION: config.version,
      DB_DATABASE: config.db.database,
      DB_USER: config.db.user,
      DB_PASSWORD: config.db.password,
      DB_SERVER: config.db.server,
      DB_TRANSACTION_LIMIT: config.db.transactionLimit,
      DB_CONNECTION_TIMEOUT: config.db.connectionTimeout,
      DB_REQUEST_TIMEOUT: config.db.requestTimeout,
      STORAGE_SERVICE: config.storageService,
      SHAPES_CONTAINER: config.shapesContainer,
      SHAPES_REGION: config.shapesRegion,
      SHAPES_SKIP: 'true',
      // importer only:
      KEYVALUE: config.keyvalue,
      KEYVALUE_VERSION_TABLE: `${config.keyvaluePrefix}-versions`,
      KEYVALUE_REGION: config.keyvalueRegion,
      // worker only:
      AT_API_KEY: config.api['nz-akl'],
      AGENDA21_API_KEY: config.api['agenda-21'],
    }

    if (subset === 'importer' || subset === 'importer-local') {
      delete base.AT_API_KEY
      delete base.AGENDA21_API_KEY
      if (subset === 'importer') {
        delete base.SHAPES_SKIP
      }
    } else {
      delete base.SHAPES_SKIP
      delete base.KEYVALUE
      delete base.KEYVALUE_VERSION_TABLE
      delete base.KEYVALUE_REGION
    }
    return base
  }

  fromEnvironmental(env: NodeJS.ProcessEnv) {
    const {
      PREFIX,
      VERSION,
      STORAGE_SERVICE,
      SHAPES_CONTAINER,
      SHAPES_REGION,
      EMULATED_STORAGE,
      DB_USER,
      DB_PASSWORD,
      DB_SERVER,
      DB_DATABASE,
      DB_TRANSACTION_LIMIT,
      DB_CONNECTION_TIMEOUT,
      DB_REQUEST_TIMEOUT,
      AT_API_KEY,
      AGENDA21_API_KEY,
    } = env
    return {
      prefix: PREFIX,
      version: VERSION,
      storageService: STORAGE_SERVICE,
      shapesContainer: SHAPES_CONTAINER,
      shapesRegion: SHAPES_REGION,
      db: {
        user: DB_USER,
        password: DB_PASSWORD,
        server: DB_SERVER,
        database: DB_DATABASE,
        transactionLimit: parseInt(DB_TRANSACTION_LIMIT, 10),
        connectionTimeout: parseInt(DB_CONNECTION_TIMEOUT, 10),
        requestTimeout: parseInt(DB_REQUEST_TIMEOUT, 10),
      },
      api: {
        'nz-akl': AT_API_KEY,
        'agenda-21': AGENDA21_API_KEY,
      },
    }
  }
}
export default EnvMapper
