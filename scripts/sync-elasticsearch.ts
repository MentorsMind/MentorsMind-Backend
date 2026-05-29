import elasticsearchIndexService from '../src/services/elasticsearch-index.service';
import { logger } from '../src/utils/logger';

async function syncElasticsearch() {
  try {
    logger.info('Starting Elasticsearch sync...');
    
    await elasticsearchIndexService.syncAll();
    
    logger.info('Elasticsearch sync completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Elasticsearch sync failed:', error);
    process.exit(1);
  }
}

syncElasticsearch();
