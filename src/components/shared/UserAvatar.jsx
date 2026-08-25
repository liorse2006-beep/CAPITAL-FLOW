import React from 'react';

const DEFAULT_AVATAR_SRC = '/icon-192.png';

function handleAvatarError(event) {
  const image = event.currentTarget;
  if (image.dataset.fallback === 'true') return;
  image.dataset.fallback = 'true';
  image.src = DEFAULT_AVATAR_SRC;
}

export default function UserAvatar({ user, className = '' }) {
  const email = String((user && user.email) || '').trim();
  const alt = email ? `${email} profile picture` : 'Profile picture';

  return (
    <img
      className={className}
      src={user && user.avatar_url ? user.avatar_url : DEFAULT_AVATAR_SRC}
      alt={alt}
      onError={handleAvatarError}
    />
  );
}
