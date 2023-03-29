import { getUserTorrentsList, deleteTorrent } from '@/api/realDebrid';
import Cookies from 'js-cookie';
import { useEffect, useState } from 'react';
import { FaTrash } from 'react-icons/fa';

interface UserTorrent {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  progress: number;
  status: string;
  added: string;
}

const TorrentsPage = () => {
  const [loading, setLoading] = useState(true);
  const [userTorrentsList, setUserTorrentsList] = useState<UserTorrent[]>([]);

  useEffect(() => {
    const fetchTorrents = async () => {
      try {
        const accessToken = Cookies.get('accessToken');
        const response = await getUserTorrentsList(
          accessToken!,
          0,
          1,
          2500,
          ''
        ) as UserTorrent[];
        setUserTorrentsList(response);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching user torrents list:', error);
      }
    };
    fetchTorrents();
  }, []);

  const handleDeleteTorrent = async (id: string) => {
    try {
      const accessToken = Cookies.get('accessToken');
      await deleteTorrent(accessToken!, id);
      setUserTorrentsList(prevList => prevList.filter(t => t.id !== id));
    } catch (error) {
      console.error(`Error deleting torrent ${id}:`, error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto my-4">
      <h1 className="text-3xl font-bold mb-4">My Torrents</h1>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Filename</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">Progress</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Added</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {userTorrentsList.map(torrent => (
              <tr key={torrent.id}>
                <td className="border px-4 py-2">{torrent.id.substring(0, 3)}</td>
                <td className="border px-4 py-2">{torrent.filename}</td>
                <td className="border px-4 py-2">
                  {(torrent.bytes / 1000000000).toFixed(1)} GB
                </td>
                <td className="border px-4 py-2">{torrent.progress}%</td>
                <td className="border px-4 py-2">{torrent.status}</td>
                <td className="border px-4 py-2">
                  {new Date(torrent.added).toLocaleString()}
                </td>
                <td className="border px-4 py-2">
                  <button
                    className="text-red-500"
                    onClick={() => handleDeleteTorrent(torrent.id)}
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TorrentsPage;
