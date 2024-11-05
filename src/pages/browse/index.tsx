import { withAuth } from '@/utils/withAuth';
import { Browse } from './[search]';

// Simply re-export the Browse component wrapped with auth
export default withAuth(Browse);
