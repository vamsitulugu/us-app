const API = window.__API_BASE__ || '';
const ChatRealtime = (() => {
  let client = null, channel = null, presenceChannel = null;

  function init(supabaseUrl, supabaseAnonKey, coupleId, role, myName) {
    client = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    channel = client.channel('chat:' + coupleId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `couple_id=eq.${coupleId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          const row = payload.new;
          const norm = ChatQueue.normalize(row);
          ChatStore.upsert(norm);
          ChatDB.put(norm);
          if (row.sender_role !== role && !row.delivered) {
            fetch(API + '/api/chat/' + row.id + '/delivered', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ coupleId })
            }).catch(()=>{});
          }
        })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.role !== role) TypingManager.onRemoteTyping(payload);
      })
      .subscribe();

    presenceChannel = client.channel('presence:' + coupleId, { config: { presence: { key: role } } });
    presenceChannel
      .on('presence', { event: 'sync' }, () => PresenceManager.onSync(presenceChannel.presenceState()))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await presenceChannel.track({ role, name: myName, online_at: Date.now() });
      });

    return { channel, presenceChannel };
  }

  function broadcastTyping(role, isTyping) {
    channel?.send({ type: 'broadcast', event: 'typing', payload: { role, isTyping, ts: Date.now() } });
  }

  return { init, broadcastTyping, getPresenceChannel: () => presenceChannel };
})();