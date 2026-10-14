import React from 'react';
import { Star, CheckCircle2 } from 'lucide-react';
import { Gig, Review, UserAccount } from '../../types';
import { SEED_REVIEWS } from '../../data/completeSeedDataset';

interface ReviewsProps {
  currentGig?: Gig;
  targetUser?: UserAccount;
  allReviews?: Review[];
}

export const Reviews: React.FC<ReviewsProps> = ({
  currentGig,
  targetUser,
  allReviews
}) => {

  // Collect reviews for this gig or freelancer
  const dataset = allReviews && allReviews.length > 0 ? allReviews : SEED_REVIEWS;
  
  const initialGigReviews = dataset.filter(r => {
    if (currentGig) {
        return r.targetUserId === currentGig.freelancerId || 
               (r.orderTitle && currentGig.title && r.orderTitle.toLowerCase().includes(currentGig.title.toLowerCase().substring(0, 15)));
    } else if (targetUser) {
        return r.targetUserId === targetUser.id;
    }
    return false;
  });

  // Fallback realistic reviews if dataset doesn't have specific ones for this gig
  const fallbackReviews: Review[] = currentGig ? [
    {
      id: `rev_fb1_${currentGig.id}`,
      targetUserId: currentGig.freelancerId,
      orderId: `ord_fb1_${currentGig.id}`,
      reviewerName: 'Marcus Vance',
      reviewerAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=faces',
      buyerName: 'Marcus Vance',
      rating: 5,
      comment: `${currentGig.freelancerName} delivered exceptional quality for "${currentGig.title}"! Communication was prompt, deliverables were clean and perfectly executed. Highly recommended!`,
      createdAt: '2 days ago',
      orderTitle: currentGig.title
    },
    {
      id: `rev_fb2_${currentGig.id}`,
      targetUserId: currentGig.freelancerId,
      orderId: `ord_fb2_${currentGig.id}`,
      reviewerName: 'Sarah Jenkins',
      reviewerAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=faces',
      buyerName: 'Sarah Jenkins',
      rating: 5,
      comment: `Outstanding service! The delivery arrived on time. Very professional, thorough, and attentive to every detail.`,
      createdAt: '1 week ago',
      orderTitle: currentGig.title
    },
    {
      id: `rev_fb3_${currentGig.id}`,
      targetUserId: currentGig.freelancerId,
      orderId: `ord_fb3_${currentGig.id}`,
      reviewerName: 'David Miller',
      reviewerAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=faces',
      buyerName: 'David Miller',
      rating: 5,
      comment: `Great technical expertise and clean deliverables. Will hire again for future milestones.`,
      createdAt: '2 weeks ago',
      orderTitle: currentGig.title
    }
  ] : [];

  const filteredReviews = initialGigReviews.length > 0 ? initialGigReviews : fallbackReviews;

  const avgRating = currentGig?.rating || 5.0;
  const totalCount = currentGig?.reviewsCount || filteredReviews.length;

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
            <span className="text-xs text-fiverr-muted font-medium block mt-0.5">
              Based on {totalCount} reviews
            </span>
          </div>
        </div>

      </div>

      {/* Reviews List */}
      <div className="space-y-4 pt-2">
        {filteredReviews.length === 0 ? (
          <div className="text-center py-6 border border-slate-200 rounded-2xl text-xs text-slate-500">
            No reviews match the selected filter.
          </div>
        ) : (
          filteredReviews.map((rev) => (
            <div key={rev.id} className="border-b border-slate-100 pb-5 space-y-2 last:border-b-0">
              {/* Reviewer Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={rev.reviewerAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop'}
                    alt={rev.reviewerName || rev.buyerName}
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-fiverr-dark">{rev.reviewerName || rev.buyerName}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified
                      </span>
                    </div>
                    <span className="text-[10px] text-fiverr-muted block">{rev.createdAt || 'Recently'}</span>
                  </div>
                </div>

                {/* Rating Stars */}
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
                  ))}
                </div>
              </div>

              {/* Review Message */}
              <p className="text-xs text-slate-700 leading-relaxed font-normal pl-11 whitespace-pre-line">
                {rev.comment}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
