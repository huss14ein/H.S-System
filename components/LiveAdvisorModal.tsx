import React from 'react';
import Modal from './Modal';
import { HeadsetIcon } from './icons/HeadsetIcon';

const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Live AI Advisor">
            <div className="text-center p-4">
                <HeadsetIcon className="h-16 w-16 mx-auto text-primary opacity-50 mb-4" />
                <h3 className="text-lg font-semibold text-dark">Live Advisor Temporarily Unavailable</h3>
                <p className="text-sm text-gray-600 mt-2 max-w-sm mx-auto">
                    The Live Advisor feature is currently undergoing a security upgrade to better protect your data and will be available again soon.
                </p>
            </div>
        </Modal>
    );
};

export default LiveAdvisorModal;
