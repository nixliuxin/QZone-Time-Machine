interface QQLinkProps {
  uin?: number | string;
  children: React.ReactNode;
  className?: string;
}

export function QQLink({ uin, children, className = '' }: QQLinkProps) {
  if (!uin) return <span className={className}>{children}</span>;
  return (
    <a
      href={`https://user.qzone.qq.com/${uin}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:underline ${className}`}
      title={`QQ空间: ${uin}`}
    >
      {children}
    </a>
  );
}
