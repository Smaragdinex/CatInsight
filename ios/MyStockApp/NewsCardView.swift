import SwiftUI

struct NewsCardView: View {
    let title: String
    let isLoading: Bool
    let emptyText: String
    let items: [NewsItem]
    let isExpanded: Bool
    let moreButton: String
    let lessButton: String
    let theme: AppTheme
    let newsDateText: (Date) -> String
    let onToggleExpanded: () -> Void
    // AI 幫你讀
    var isZh: Bool = true
    var digest: NewsDigestResponse? = nil
    var digestLoading: Bool = false
    var onDigest: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.headline)
                    .foregroundColor(theme.primaryText)

                Spacer()

                if !items.isEmpty && digest == nil && !digestLoading {
                    Button(action: onDigest) {
                        HStack(spacing: 5) {
                            Image(systemName: "sparkles")
                            Text(isZh ? "AI 幫你讀" : "AI read it")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color.blue)
                        .cornerRadius(10)
                    }
                }
            }

            if digestLoading {
                HStack(spacing: 8) {
                    ProgressView().tint(theme.primaryText)
                    Text(isZh ? "AI 正在讀這幾則新聞…" : "AI is reading the news…")
                        .font(.caption).foregroundColor(theme.secondaryText)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.cardBackground)
                .cornerRadius(12)
            } else if let digest {
                digestView(digest)
            }

            if isLoading {
                ProgressView()
                    .tint(theme.primaryText)
            } else if items.isEmpty {
                Text(emptyText)
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryText)
            } else {
                let visibleItems = isExpanded ? items : Array(items.prefix(3))
                LazyVStack(spacing: 0) {
                    ForEach(Array(visibleItems.enumerated()), id: \.element.id) { index, item in
                        Link(destination: URL(string: item.url ?? "") ?? URL(string: "https://finance.yahoo.com")!) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(item.title)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .foregroundColor(theme.primaryText)
                                    .multilineTextAlignment(.leading)

                                if let summary = item.summary, !summary.isEmpty {
                                    Text(summary)
                                        .font(.caption)
                                        .foregroundColor(theme.secondaryText)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                }

                                HStack(spacing: 8) {
                                    if let provider = item.provider, !provider.isEmpty {
                                        Text(provider)
                                    }
                                    if let published = item.publishedDate {
                                        Text(newsDateText(published))
                                    }
                                }
                                .font(.caption2)
                                .foregroundColor(theme.secondaryText)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 12)
                        }

                        if items.count > 3 && index == visibleItems.count - 1 {
                            Button(isExpanded ? lessButton : moreButton, action: onToggleExpanded)
                                .font(.caption)
                                .foregroundColor(.blue)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 4)
                                .padding(.bottom, 12)
                        }

                        if index != visibleItems.count - 1 {
                            Divider().overlay(theme.divider)
                        }
                    }
                }
            }
        }
        .padding()
        .background(theme.appBackground)
    }

    /// 摘要卡:左側色條 + 偏多/偏空/中性 標籤 + 3 句話
    private func digestView(_ d: NewsDigestResponse) -> some View {
        let (label, color): (String, Color) = {
            switch d.sentiment {
            case "positive": return (isZh ? "整體偏多" : "Overall positive", .green)
            case "negative": return (isZh ? "整體偏空" : "Overall negative", .red)
            default: return (isZh ? "整體中性" : "Overall neutral", .orange)
            }
        }()
        return HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 4)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").font(.caption).foregroundColor(color)
                    Text(label).font(.caption.weight(.semibold)).foregroundColor(color)
                    if let n = d.count, n > 0 {
                        Text(isZh ? "・讀了 \(n) 則" : "・\(n) articles").font(.caption2).foregroundColor(theme.secondaryText)
                    }
                    Spacer()
                }
                if d.summary.isEmpty {
                    Text(d.error != nil ? (isZh ? "AI 暫時讀不到,請再試一次。" : "AI couldn't read the news, try again.")
                                        : (isZh ? "目前沒有可讀的新聞。" : "No news to read."))
                        .font(.subheadline).foregroundColor(theme.secondaryText)
                    Button(action: onDigest) {
                        Text(isZh ? "再試一次" : "Retry").font(.caption).foregroundColor(.blue)
                    }
                } else {
                    Text(d.summary)
                        .font(.subheadline).foregroundColor(theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(12)
        .background(theme.cardBackground)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.divider, lineWidth: 1))
    }
}
