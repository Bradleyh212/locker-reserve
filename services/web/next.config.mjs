const nextConfig = {
	output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,

	devIndicators: false,
}

export default nextConfig
