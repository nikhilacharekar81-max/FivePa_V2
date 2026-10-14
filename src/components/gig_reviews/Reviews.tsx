import React from 'react';
import { Star, CheckCircle2 } from 'lucide-react';
import { Gig, Review, UserAccount } from '../../types';

interface ReviewsProps {
  currentGig?: Gig;
  targetUser?: UserAccount;
  allReviews?: Review[];
}

export const Reviews: React.FC<ReviewsProps> = ({
  currentGig,
  targetUser,
  allReviews = []
}) => {
  // Collect reviews for this gig or freelancer
  const dataset = allReviews || [];
  
  const filteredReviews = dataset.filter(r => {
    if (currentGig) {
      return r.targetUserId === currentGig.freelancerId || 
             (r.orderTitle && currentGig.title && r.orderTitle.toLowerCase().includes(currentGig.title.toLowerCase().substring(0, 15)));
    } else if (targetUser) {
      return r.targetUserId === targetUser.id;
    }
    return false;
  });

  const avgRating = currentGig?.rating || (filteredReviews.length > 0 ? (filteredReviews.reduce((s, r) => s + r.rating, 0) / filteredReviews.length) : 0);
  const totalCount = filteredReviews.length;

  return (
    <div className="pt-6 font-sans space-y-6">
      {/* Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-[21px] font-bold text-fiverr-dark tracking-tight flex items-center gap-2">
            <span>Customer Reviews</span>
            <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full">
              {totalCount}
            </span>
          </h2>
          <p className="text-xs text-fiverr-muted mt-1">
            Real feedback from verified buyers.
          </p>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="p-8 bg-slate-50 border border-slate-200 rounded-2xl text-center text-xs text-slate-500 font-medium">
          No customer reviews yet.
        </div>
      ) : (
        <>
          {/* Rating Summary Header */}
          <div className="flex items-center gap-6 pb-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-black text-fiverr-dark font-mono">{avgRating.toFixed(1)}</span>
              <div>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <span className="text-xs text-fiverr-muted font-medium mt-0.5 block">
                  Based on {totalCount} verified review{totalCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Individual Reviews List */}
          <div className="space-y-4">
            {filteredReviews.map((rev) => (
              <div key={rev.id} className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img 
                      src={rev.reviewerAvatar || rev.buyerAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'} 
                      alt={rev.reviewerName || rev.buyerName || 'Buyer'} 
                      className="w-9 h-9 rounded-full object-cover border border-slate-200"
                    />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-fiverr-dark">{rev.reviewerName || rev.buyerName || 'Verified Client'}</span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                          <span>Verified Purchase</span>
                        </span>
                      </div>
                      <span className="text-[10px] text-fiverr-muted">{rev.createdAt || 'Recent'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {[...Array(rev.rating || 5)].map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {rev.comment}
                </p>

                {rev.orderTitle && (
                  <div className="text-[10px] text-fiverr-muted bg-slate-50 p-2 rounded-lg border border-slate-100 line-clamp-1">
                    <span className="font-semibold text-slate-600">Service:</span> {rev.orderTitle}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
